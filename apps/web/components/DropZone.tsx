'use client';

import { useRef, useState } from 'react';
import { MAX_UPLOAD_BYTES } from '@mydivelog/contracts';
import { PendingNotice } from './SubmitButton';

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * A file picker that also accepts a drop.
 *
 * The input is a real form control inside a real form, so the page works with
 * no JavaScript at all — the drop handling is added on top rather than
 * replacing it. An import is the first thing a new diver does, and it should
 * not be the thing that needs a working bundle.
 */
export function DropZone({ action }: { action: (formData: FormData) => void }) {
  const [over, setOver] = useState(false);
  const [name, setName] = useState<string | undefined>();
  const [tooBig, setTooBig] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  /*
   * Checked here, before anything is posted.
   *
   * An oversized body is rejected by Next itself, before the Server Action
   * runs, so there is no server-side code that could turn it into a sentence.
   * The browser already knows the size — asking it is the only way anyone gets
   * told what went wrong.
   */
  const accept = (file: File | undefined): boolean => {
    if (!file) return false;
    setName(file.name);
    if (file.size > MAX_UPLOAD_BYTES) {
      setTooBig(
        `${file.name} is ${megabytes(file.size)}. The limit is ${megabytes(MAX_UPLOAD_BYTES)} — ` +
          `if it is a whole dive computer export, try splitting it by year.`,
      );
      return false;
    }
    setTooBig(undefined);
    return true;
  };

  return (
    <form action={action} ref={form}>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const dropped = event.dataTransfer.files?.[0];
          if (!dropped || !input.current) return;
          if (!accept(dropped)) return;

          // Assigning to the input rather than posting the File directly keeps
          // one submission path: what a drop does and what the picker does are
          // then the same thing.
          const transfer = new DataTransfer();
          transfer.items.add(dropped);
          input.current.files = transfer.files;
          form.current?.requestSubmit();
        }}
      >
        <label htmlFor="file" className="drop-label">
          <strong>Drop a file here</strong>
          <span className="muted"> or choose one</span>
        </label>
        <input
          ref={input}
          id="file"
          name="file"
          type="file"
          onChange={(event) => {
            if (accept(event.target.files?.[0])) form.current?.requestSubmit();
          }}
        />
        {name && !tooBig && <p className="muted small">{name}</p>}
        <PendingNotice>
          Reading {name ?? 'your file'}. A large dive computer export takes a moment.
        </PendingNotice>
      </div>
      {tooBig && (
        <p className="notice bad" role="alert">
          {tooBig}
        </p>
      )}
      {/* Visible only without JavaScript, where the change handler cannot
          submit for you. */}
      <noscript>
        <button className="button" type="submit">
          Upload
        </button>
      </noscript>
    </form>
  );
}
