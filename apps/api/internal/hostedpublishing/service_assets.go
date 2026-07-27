package hostedpublishing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/attribute"
)

var allowedAssetMediaTypes = map[string]string{
	"image/jpeg": "image",
	"image/png":  "image",
	"image/webp": "image",
	"image/gif":  "image",
	"video/mp4":  "video",
}

func (s *Service) UploadAsset(ctx context.Context, actor Actor, projectID, filename, declaredMediaType string, body io.Reader) (Asset, error) {
	ctx, span := s.operation(ctx, "asset.upload", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	if s.objects == nil || s.assetBase == "" {
		return Asset{}, ErrAssetStorageUnavailable
	}
	if err := s.repository.View(ctx, func(reader Reader) error {
		_, err := projectAccess(reader, actor, projectID, true)
		return err
	}); err != nil {
		return Asset{}, err
	}
	filename = strings.TrimSpace(filepath.Base(filename))
	if filename == "" || filename == "." || len(filename) > 255 {
		return Asset{}, ErrAssetInvalid
	}
	content, err := io.ReadAll(io.LimitReader(body, s.assetLimit+1))
	if err != nil || len(content) == 0 || int64(len(content)) > s.assetLimit {
		return Asset{}, ErrAssetInvalid
	}
	mediaType := http.DetectContentType(content[:min(len(content), 512)])
	kind, ok := allowedAssetMediaTypes[mediaType]
	if !ok {
		return Asset{}, ErrAssetInvalid
	}
	declaredMediaType = strings.TrimSpace(strings.Split(declaredMediaType, ";")[0])
	if declaredMediaType != "" && declaredMediaType != "application/octet-stream" && declaredMediaType != mediaType {
		return Asset{}, ErrAssetInvalid
	}
	digest := "sha256:" + ContentHash(content)
	var asset Asset
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		now := s.now()
		asset = Asset{
			ID: tx.NextID("asset"), ProjectID: projectID, Kind: kind, OriginalFilename: filename,
			MediaType: mediaType, ByteLength: int64(len(content)), ContentDigest: digest,
			Status: "pending", CreatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now,
		}
		asset.StorageKey = fmt.Sprintf("projects/%s/assets/%s/%s", projectID, asset.ID, strings.TrimPrefix(digest, "sha256:"))
		asset.URL = s.assetBase + "/" + asset.ID + "/" + digest
		tx.SaveAsset(asset)
		s.audit(tx, actor, project, "", "asset.upload_started", "asset", asset.ID, map[string]string{})
		return nil
	})
	if err != nil {
		return Asset{}, err
	}
	if err := s.objects.Put(ctx, asset.StorageKey, bytes.NewReader(content), asset.ByteLength, asset.MediaType); err != nil {
		span.RecordError(err)
		_ = s.setAssetStatus(ctx, asset.ID, "failed")
		zerolog.Ctx(ctx).Error().Err(err).Str("asset_id", asset.ID).Msg("asset storage upload failed")
		return Asset{}, ErrAssetStorage
	}
	if err := s.setAssetStatus(ctx, asset.ID, "ready"); err != nil {
		span.RecordError(err)
		return Asset{}, err
	}
	asset.Status = "ready"
	asset.UpdatedAt = s.now()
	return asset, nil
}

func (s *Service) setAssetStatus(ctx context.Context, assetID, status string) error {
	return s.repository.Transact(ctx, func(tx Transaction) error {
		asset, ok := tx.Asset(assetID)
		if !ok {
			return ErrNotFound
		}
		asset.Status, asset.UpdatedAt = status, s.now()
		tx.SaveAsset(asset)
		return nil
	})
}

func (s *Service) ListAssets(ctx context.Context, actor Actor, projectID string) (List[Asset], error) {
	result := List[Asset]{Items: []Asset{}}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		result.Items = reader.Assets(projectID)
		return nil
	})
	return result, err
}

func (s *Service) GetAsset(ctx context.Context, actor Actor, projectID, assetID string) (Asset, error) {
	var result Asset
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		asset, ok := reader.Asset(assetID)
		if !ok || asset.ProjectID != projectID {
			return ErrNotFound
		}
		result = asset
		return nil
	})
	return result, err
}

func (s *Service) ArchiveAsset(ctx context.Context, actor Actor, projectID, assetID string) (Asset, error) {
	var result Asset
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		asset, ok := tx.Asset(assetID)
		if !ok || asset.ProjectID != projectID {
			return ErrNotFound
		}
		if asset.Status == "archived" {
			result = asset
			return nil
		}
		if asset.Status != "ready" {
			return ErrAssetNotReady
		}
		now := s.now()
		asset.Status, asset.ArchivedAt, asset.UpdatedAt = "archived", &now, now
		tx.SaveAsset(asset)
		s.audit(tx, actor, project, "", "asset.archived", "asset", asset.ID, map[string]string{})
		result = asset
		return nil
	})
	return result, err
}

func (s *Service) GetAssetUsage(ctx context.Context, actor Actor, projectID, assetID string) (AssetUsage, error) {
	var result AssetUsage
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		asset, ok := reader.Asset(assetID)
		if !ok || asset.ProjectID != projectID {
			return ErrNotFound
		}
		result = reader.AssetUsage(assetID)
		return nil
	})
	return result, err
}

func (s *Service) OpenAsset(ctx context.Context, assetID, digest string) (AssetObject, error) {
	if s.objects == nil {
		return AssetObject{}, ErrAssetStorageUnavailable
	}
	var asset Asset
	err := s.repository.View(ctx, func(reader Reader) error {
		value, ok := reader.Asset(assetID)
		if !ok || (value.Status != "ready" && value.Status != "archived") || value.ContentDigest != digest {
			return ErrNotFound
		}
		asset = value
		return nil
	})
	if err != nil {
		return AssetObject{}, err
	}
	body, err := s.objects.Open(ctx, asset.StorageKey)
	if err != nil {
		var missing interface{ ObjectNotFound() bool }
		if errors.As(err, &missing) && missing.ObjectNotFound() {
			// A referenced object that is not in the bucket is a data-integrity
			// problem for the operator (see the missing-object detection in
			// scripts/restore-objects.sh) but a plain "not found" for the caller.
			zerolog.Ctx(ctx).Error().Err(err).Str("asset_id", asset.ID).
				Str("storage_key", asset.StorageKey).
				Msg("asset object is referenced by the database but missing from object storage")
			return AssetObject{}, ErrAssetObjectMissing
		}
		zerolog.Ctx(ctx).Error().Err(err).Str("asset_id", asset.ID).Msg("asset storage read failed")
		return AssetObject{}, ErrAssetStorage
	}
	return AssetObject{Asset: asset, Body: body}, nil
}
