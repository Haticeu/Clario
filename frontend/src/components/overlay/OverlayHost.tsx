import { closeOverlay, useOverlay } from '../../utils/overlay'
import { NewsReader } from '../news/NewsReader'
import { LedgerView } from '../receivables/LedgerView'
import { OrderView } from '../search/OrderView'

/** Açık okuma görünümünü (haber, işlem) gösterir; App içinde bir kez bulunur */
export function OverlayHost() {
  const overlay = useOverlay()
  if (!overlay) return null
  if (overlay.kind === 'news') return <NewsReader key={overlay.item.id} item={overlay.item} onClose={closeOverlay} />
  if (overlay.kind === 'ledger') return <LedgerView key={overlay.customerId} customerId={overlay.customerId} onClose={closeOverlay} />
  return <OrderView key={overlay.id} id={overlay.id} onClose={closeOverlay} />
}
