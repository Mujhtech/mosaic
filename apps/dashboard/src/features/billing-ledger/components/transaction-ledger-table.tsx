import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome"
import {
  factKindLabel,
  formatBillingTimestamp,
  providerLabel,
  resolutionStateLabel,
  storeEnvironmentLabel,
  transactionTypeLabel,
  TIMESTAMP_DISTINCTION_NOTE,
} from "@/features/billing-ledger/types/billing-vocabulary"
import type { Application, Product, TransactionFact } from "@/generated/api"

interface TransactionLedgerTableProps {
  applications: readonly Application[]
  environmentName: string
  factHref: (factId: string) => string
  isPending: boolean
  items: readonly TransactionFact[]
  products: readonly Product[]
}

/**
 * The Transaction Fact table.
 *
 * Every row is a statement that a store confirmed something happened. There is
 * no row action, no bulk selection, and no editable cell: the ledger is
 * append-only and nothing on this screen can change a recorded fact.
 *
 * Both timestamps are always visible and separately labelled, and Mosaic
 * Environment and Store Environment occupy separate columns.
 */
export function TransactionLedgerTable({
  applications,
  environmentName,
  factHref,
  isPending,
  items,
  products,
}: TransactionLedgerTableProps) {
  function applicationName(applicationId: string | undefined) {
    if (!applicationId) return "—"
    return applications.find((item) => item.id === applicationId)?.name ?? applicationId
  }

  function productName(productId: string | undefined) {
    if (!productId) return undefined
    return products.find((item) => item.id === productId)?.internalName ?? productId
  }

  return (
    <Table>
      <TableCaption>
        Store-confirmed Transaction Facts in the {environmentName} Mosaic Environment.{" "}
        {TIMESTAMP_DISTINCTION_NOTE}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Transaction</TableHead>
          <TableHead scope="col">Store</TableHead>
          <TableHead scope="col">Store Environment</TableHead>
          <TableHead scope="col">Mosaic Environment</TableHead>
          <TableHead scope="col">Application</TableHead>
          <TableHead scope="col">Mosaic Product</TableHead>
          <TableHead scope="col">Resolution</TableHead>
          <TableHead scope="col">Fact</TableHead>
          <TableHead scope="col">Occurred at</TableHead>
          <TableHead scope="col">Recorded at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: 5 }, (_, index) => (
              <TableRow key={`skeleton-${index}`}>
                {Array.from({ length: 10 }, (__, cell) => (
                  <TableCell key={`skeleton-${index}-${cell}`}>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : items.map((fact) => {
              const resolved = productName(fact.mosaicProductId)
              return (
                <TableRow key={fact.id}>
                  <TableCell>
                    <a
                      className="text-primary font-medium"
                      href={factHref(fact.id ?? "")}
                      title={fact.providerTransactionId}
                    >
                      {fact.providerTransactionId ?? fact.id ?? "—"}
                    </a>
                    <span className="text-muted-foreground block text-xs">
                      {transactionTypeLabel(fact.transactionType)}
                    </span>
                  </TableCell>
                  <TableCell>{providerLabel(fact.provider)}</TableCell>
                  <TableCell>{storeEnvironmentLabel(fact.storeEnvironment)}</TableCell>
                  <TableCell>{environmentName}</TableCell>
                  <TableCell>{applicationName(fact.applicationId)}</TableCell>
                  <TableCell>
                    {resolved ?? <span className="text-muted-foreground">Unresolved</span>}
                    <span className="text-muted-foreground block text-xs">
                      {fact.providerProductIdentifier ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      label={resolutionStateLabel(fact.resolutionState)}
                      tone={
                        fact.resolutionState === "unresolved"
                          ? "attention"
                          : fact.resolutionState === "active_mapping"
                            ? "positive"
                            : "neutral"
                      }
                    />
                  </TableCell>
                  <TableCell>{factKindLabel(fact.factKind)}</TableCell>
                  <TableCell title={fact.occurredAt}>
                    {formatBillingTimestamp(fact.occurredAt)}
                  </TableCell>
                  <TableCell title={fact.recordedAt}>
                    {formatBillingTimestamp(fact.recordedAt)}
                  </TableCell>
                </TableRow>
              )
            })}
      </TableBody>
    </Table>
  )
}
