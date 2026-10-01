/** Bind focus only while a local dialog is mounted; return it to the invoking control on close. */
export function bindDialogFocus(dialog: HTMLElement): () => void {
  const doc = dialog.ownerDocument;
  const previous = doc.activeElement as HTMLElement | null;
  const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
  )).filter(element => element.getClientRects().length > 0);
  const focusFirst = () => (controls()[0] || dialog).focus();
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const items = controls();
    const index = items.indexOf(doc.activeElement as HTMLElement);
    if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] || dialog : items[0] || dialog).focus();
    }
  };
  const focusin = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node)) focusFirst();
  };
  dialog.addEventListener('keydown', keydown);
  doc.addEventListener('focusin', focusin);
  focusFirst();
  return () => {
    dialog.removeEventListener('keydown', keydown);
    doc.removeEventListener('focusin', focusin);
    if (previous?.isConnected) previous.focus();
  };
}
