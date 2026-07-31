// Package billingmigrationobject implements Mosaic's streaming authenticated
// source-object envelope. It is intentionally separate from the small-secret
// provider credential envelope because source objects can be 100 MiB.
package billingmigrationobject

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

const (
	EnvelopeVersion  = 1
	Algorithm        = "AES-256-GCM-CHUNKED"
	DefaultChunkSize = 256 * 1024
	minChunkSize     = 16 * 1024
	maxChunkSize     = 4 * 1024 * 1024
)

var magic = [8]byte{'M', 'S', 'O', 'B', 'J', '0', '0', '1'}

type Cipher struct {
	activeKeyID string
	keys        map[string][]byte
	chunkSize   int
	random      io.Reader
}

func NewCipher(keyID string, key []byte, chunkSize int) (*Cipher, error) {
	if keyID == "" || len(key) != 32 {
		return nil, errors.New("source-object cipher requires a key id and 32-byte key")
	}
	if chunkSize == 0 {
		chunkSize = DefaultChunkSize
	}
	if chunkSize < minChunkSize || chunkSize > maxChunkSize {
		return nil, errors.New("source-object chunk size is outside the allowed range")
	}
	return &Cipher{activeKeyID: keyID, keys: map[string][]byte{keyID: append([]byte(nil), key...)}, chunkSize: chunkSize, random: rand.Reader}, nil
}

// NewKeyringCipher constructs a rotation-capable source-object cipher. New
// objects use activeKeyId while every retained key remains available to open
// older immutable objects during the retention and rollback windows.
func NewKeyringCipher(encoded string, chunkSize int) (*Cipher, error) {
	active, keys, err := parseKeyring(encoded)
	if err != nil {
		return nil, err
	}
	if chunkSize == 0 {
		chunkSize = DefaultChunkSize
	}
	if chunkSize < minChunkSize || chunkSize > maxChunkSize {
		return nil, errors.New("source-object chunk size is outside the allowed range")
	}
	return &Cipher{activeKeyID: active, keys: keys, chunkSize: chunkSize, random: rand.Reader}, nil
}

// ValidateKeyring checks configuration without retaining or returning key
// material. The format intentionally matches Mosaic's other versioned AES key
// rings while remaining a separate cryptographic category.
func ValidateKeyring(encoded string) error {
	_, _, err := parseKeyring(encoded)
	return err
}

func (c *Cipher) ActiveKeyID() string { return c.activeKeyID }

func (c *Cipher) KeyIDs() []string {
	ids := make([]string, 0, len(c.keys))
	for id := range c.keys {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (c *Cipher) Encrypt(ctx context.Context, scope billingmigration.SourceObjectScope, plaintext io.Reader, output io.Writer) (billingmigration.SourceObjectEnvelope, error) {
	key, ok := c.keys[c.activeKeyID]
	if !ok {
		return billingmigration.SourceObjectEnvelope{}, errors.New("source-object active key is unavailable")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return billingmigration.SourceObjectEnvelope{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return billingmigration.SourceObjectEnvelope{}, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(c.random, nonce); err != nil {
		return billingmigration.SourceObjectEnvelope{}, err
	}
	aadDigest := sha256.Sum256(scope.AAD())
	plainHash, cipherHash := sha256.New(), sha256.New()
	counting := &countWriter{writer: io.MultiWriter(output, cipherHash)}
	if err := writeHeader(counting, nonce, aadDigest[:], c.activeKeyID, c.chunkSize); err != nil {
		return billingmigration.SourceObjectEnvelope{}, err
	}

	limited := &io.LimitedReader{R: plaintext, N: billingmigration.SourceObjectMaxPlaintext + 1}
	buffer := make([]byte, c.chunkSize)
	var plaintextSize int64
	chunkCount := 0
	for {
		if err := ctx.Err(); err != nil {
			return billingmigration.SourceObjectEnvelope{}, err
		}
		n, readErr := io.ReadFull(limited, buffer)
		if readErr != nil && readErr != io.ErrUnexpectedEOF && readErr != io.EOF {
			return billingmigration.SourceObjectEnvelope{}, readErr
		}
		if n > 0 {
			plaintextSize += int64(n)
			if plaintextSize > billingmigration.SourceObjectMaxPlaintext {
				return billingmigration.SourceObjectEnvelope{}, billingmigration.ErrSourceObjectTooLarge
			}
			_, _ = plainHash.Write(buffer[:n])
			sealed := aead.Seal(nil, chunkNonce(nonce, uint32(chunkCount)), buffer[:n], chunkAAD(scope.AAD(), uint32(chunkCount), uint32(n), false))
			if err := binary.Write(counting, binary.BigEndian, uint32(n)); err != nil {
				return billingmigration.SourceObjectEnvelope{}, err
			}
			if _, err := counting.Write(sealed); err != nil {
				return billingmigration.SourceObjectEnvelope{}, err
			}
			chunkCount++
		}
		if readErr == io.EOF || readErr == io.ErrUnexpectedEOF {
			break
		}
	}
	// An authenticated terminal record distinguishes a complete stream from a
	// valid prefix whose final bytes were truncated.
	if err := binary.Write(counting, binary.BigEndian, uint32(0)); err != nil {
		return billingmigration.SourceObjectEnvelope{}, err
	}
	terminal := aead.Seal(nil, chunkNonce(nonce, uint32(chunkCount)), nil, chunkAAD(scope.AAD(), uint32(chunkCount), 0, true))
	if _, err := counting.Write(terminal); err != nil {
		return billingmigration.SourceObjectEnvelope{}, err
	}
	return billingmigration.SourceObjectEnvelope{Version: EnvelopeVersion, Algorithm: Algorithm, KeyID: c.activeKeyID, Nonce: nonce,
		ChunkSize: c.chunkSize, ChunkCount: chunkCount, AADDigest: aadDigest[:], PlaintextDigest: plainHash.Sum(nil),
		PlaintextSize: plaintextSize, CiphertextDigest: cipherHash.Sum(nil), CiphertextSize: counting.count}, nil
}

func (c *Cipher) Decrypt(ctx context.Context, scope billingmigration.SourceObjectScope, expected billingmigration.SourceObjectEnvelope, input io.Reader, output io.Writer) error {
	if expected.Version != EnvelopeVersion || expected.Algorithm != Algorithm {
		return billingmigration.ErrSourceObjectCorrupt
	}
	key, ok := c.keys[expected.KeyID]
	if !ok {
		return billingmigration.ErrSourceObjectCorrupt
	}
	cipherHash := sha256.New()
	counting := &countReader{reader: io.TeeReader(input, cipherHash)}
	nonce, aadDigest, keyID, chunkSize, err := readHeader(counting)
	actualAAD := sha256.Sum256(scope.AAD())
	if err != nil || keyID != expected.KeyID || chunkSize != expected.ChunkSize || !bytes.Equal(nonce, expected.Nonce) || !bytes.Equal(aadDigest, expected.AADDigest) || !bytes.Equal(aadDigest, actualAAD[:]) {
		return billingmigration.ErrSourceObjectCorrupt
	}
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	plainHash := sha256.New()
	plainWriter := io.MultiWriter(output, plainHash)
	var plaintextSize int64
	chunkCount := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var size uint32
		if err := binary.Read(counting, binary.BigEndian, &size); err != nil {
			return billingmigration.ErrSourceObjectCorrupt
		}
		if size > uint32(chunkSize) {
			return billingmigration.ErrSourceObjectCorrupt
		}
		sealed := make([]byte, int(size)+aead.Overhead())
		if _, err := io.ReadFull(counting, sealed); err != nil {
			return billingmigration.ErrSourceObjectCorrupt
		}
		final := size == 0
		opened, err := aead.Open(nil, chunkNonce(nonce, uint32(chunkCount)), sealed, chunkAAD(scope.AAD(), uint32(chunkCount), size, final))
		if err != nil {
			return billingmigration.ErrSourceObjectCorrupt
		}
		if final {
			if len(opened) != 0 {
				return billingmigration.ErrSourceObjectCorrupt
			}
			break
		}
		plaintextSize += int64(len(opened))
		if plaintextSize > billingmigration.SourceObjectMaxPlaintext {
			return billingmigration.ErrSourceObjectTooLarge
		}
		if _, err := plainWriter.Write(opened); err != nil {
			return err
		}
		chunkCount++
	}
	var trailing [1]byte
	if n, err := counting.Read(trailing[:]); n != 0 || err != io.EOF {
		return billingmigration.ErrSourceObjectCorrupt
	}
	if counting.count != expected.CiphertextSize || plaintextSize != expected.PlaintextSize || chunkCount != expected.ChunkCount || !bytes.Equal(cipherHash.Sum(nil), expected.CiphertextDigest) || !bytes.Equal(plainHash.Sum(nil), expected.PlaintextDigest) {
		return billingmigration.ErrSourceObjectCorrupt
	}
	return nil
}

func parseKeyring(encoded string) (string, map[string][]byte, error) {
	decoder := json.NewDecoder(strings.NewReader(encoded))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return "", nil, errors.New("invalid source-object keyring")
	}
	seen := make(map[string]struct{}, 3)
	version, active := 0, ""
	var encodedKeys map[string]string
	for decoder.More() {
		nameToken, tokenErr := decoder.Token()
		name, ok := nameToken.(string)
		if tokenErr != nil || !ok {
			return "", nil, errors.New("invalid source-object keyring")
		}
		if _, duplicate := seen[name]; duplicate {
			return "", nil, errors.New("invalid source-object keyring")
		}
		seen[name] = struct{}{}
		switch name {
		case "version":
			if err := decoder.Decode(&version); err != nil {
				return "", nil, errors.New("invalid source-object keyring")
			}
		case "activeKeyId":
			if err := decoder.Decode(&active); err != nil {
				return "", nil, errors.New("invalid source-object keyring")
			}
		case "keys":
			encodedKeys, err = decodeKeyMap(decoder)
			if err != nil {
				return "", nil, err
			}
		default:
			return "", nil, errors.New("invalid source-object keyring")
		}
	}
	if last, err := decoder.Token(); err != nil || last != json.Delim('}') {
		return "", nil, errors.New("invalid source-object keyring")
	}
	if _, err := decoder.Token(); err != io.EOF || version != 1 || !validKeyID(active) || len(encodedKeys) == 0 {
		return "", nil, errors.New("invalid source-object keyring")
	}
	keys := make(map[string][]byte, len(encodedKeys))
	for id, value := range encodedKeys {
		if !validKeyID(id) || strings.Contains(value, "=") {
			return "", nil, errors.New("invalid source-object keyring")
		}
		key, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil || len(key) != 32 || base64.RawURLEncoding.EncodeToString(key) != value {
			return "", nil, errors.New("invalid source-object keyring")
		}
		keys[id] = append([]byte(nil), key...)
	}
	if _, ok := keys[active]; !ok {
		return "", nil, errors.New("invalid source-object keyring")
	}
	return active, keys, nil
}

func decodeKeyMap(decoder *json.Decoder) (map[string]string, error) {
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return nil, errors.New("invalid source-object keyring")
	}
	values := make(map[string]string)
	for decoder.More() {
		keyToken, tokenErr := decoder.Token()
		key, ok := keyToken.(string)
		if tokenErr != nil || !ok {
			return nil, errors.New("invalid source-object keyring")
		}
		if _, duplicate := values[key]; duplicate {
			return nil, errors.New("invalid source-object keyring")
		}
		var value string
		if err := decoder.Decode(&value); err != nil {
			return nil, errors.New("invalid source-object keyring")
		}
		values[key] = value
	}
	if last, err := decoder.Token(); err != nil || last != json.Delim('}') {
		return nil, errors.New("invalid source-object keyring")
	}
	return values, nil
}

func validKeyID(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for i := range len(value) {
		if value[i] < 0x20 || value[i] > 0x7e {
			return false
		}
	}
	return true
}

func writeHeader(w io.Writer, nonce, aadDigest []byte, keyID string, chunkSize int) error {
	if _, err := w.Write(magic[:]); err != nil {
		return err
	}
	if err := binary.Write(w, binary.BigEndian, uint16(EnvelopeVersion)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.BigEndian, uint32(chunkSize)); err != nil {
		return err
	}
	if _, err := w.Write(nonce); err != nil {
		return err
	}
	if _, err := w.Write(aadDigest); err != nil {
		return err
	}
	if len(keyID) > 255 {
		return errors.New("key id too long")
	}
	if err := binary.Write(w, binary.BigEndian, uint8(len(keyID))); err != nil {
		return err
	}
	_, err := io.WriteString(w, keyID)
	return err
}

func readHeader(r io.Reader) ([]byte, []byte, string, int, error) {
	var got [8]byte
	if _, err := io.ReadFull(r, got[:]); err != nil || got != magic {
		return nil, nil, "", 0, billingmigration.ErrSourceObjectCorrupt
	}
	var version uint16
	var chunkSize uint32
	if binary.Read(r, binary.BigEndian, &version) != nil || version != EnvelopeVersion || binary.Read(r, binary.BigEndian, &chunkSize) != nil || chunkSize < minChunkSize || chunkSize > maxChunkSize {
		return nil, nil, "", 0, billingmigration.ErrSourceObjectCorrupt
	}
	nonce, aad := make([]byte, 12), make([]byte, 32)
	if _, err := io.ReadFull(r, nonce); err != nil {
		return nil, nil, "", 0, err
	}
	if _, err := io.ReadFull(r, aad); err != nil {
		return nil, nil, "", 0, err
	}
	var keyLen uint8
	if binary.Read(r, binary.BigEndian, &keyLen) != nil || keyLen == 0 {
		return nil, nil, "", 0, billingmigration.ErrSourceObjectCorrupt
	}
	key := make([]byte, keyLen)
	if _, err := io.ReadFull(r, key); err != nil {
		return nil, nil, "", 0, err
	}
	return nonce, aad, string(key), int(chunkSize), nil
}

func chunkNonce(base []byte, index uint32) []byte {
	nonce := append([]byte(nil), base...)
	tail := binary.BigEndian.Uint32(nonce[len(nonce)-4:])
	binary.BigEndian.PutUint32(nonce[len(nonce)-4:], tail^index)
	return nonce
}
func chunkAAD(aad []byte, index, size uint32, final bool) []byte {
	result := make([]byte, 0, len(aad)+9)
	result = append(result, aad...)
	var value [4]byte
	binary.BigEndian.PutUint32(value[:], index)
	result = append(result, value[:]...)
	binary.BigEndian.PutUint32(value[:], size)
	result = append(result, value[:]...)
	if final {
		result = append(result, 1)
	} else {
		result = append(result, 0)
	}
	return result
}

type countWriter struct {
	writer io.Writer
	count  int64
}

func (w *countWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	w.count += int64(n)
	return n, err
}

type countReader struct {
	reader io.Reader
	count  int64
}

func (r *countReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.count += int64(n)
	return n, err
}

var _ billingmigration.SourceObjectCipher = (*Cipher)(nil)
