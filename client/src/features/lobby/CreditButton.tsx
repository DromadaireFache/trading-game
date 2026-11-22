import { useId, useRef } from 'react';

export function CreditButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button type="button" className="btn btn--ghost" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        Credit
      </button>
      <dialog className="credit-dialog" ref={dialogRef} aria-labelledby={titleId}>
        <h2 id={titleId}>Credit</h2>
        <h3>Authors</h3>
        <ul className="credit-dialog__authors">
          <li>Claude</li>
          <li>ChatGPT</li>
        </ul>
        <h3>GitHub contributors</h3>
        <ul className="credit-dialog__contributors">
          <li>@Daesere</li>
          <li>@forknay</li>
          <li>@CharloZeBerlingo</li>
          <li>@DromadaireFache</li>
        </ul>
        <button type="button" className="btn btn--primary" onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
