/** Drag-and-drop area with a regular file input (keyboard and screen-reader friendly). */

import { type DragEvent, useId, useState } from 'react';
import type { SourceFile } from '../model/load.ts';
import { Icon } from './ui.tsx';

export async function readFiles(list: FileList | readonly File[]): Promise<SourceFile[]> {
  const files = Array.from(list);
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export function DropZone({
  onFiles,
  label,
  hint,
  multiple = true,
  accept = '.csv,.tsv,.txt,.json',
  testId,
}: {
  onFiles: (files: SourceFile[]) => void;
  label: string;
  hint?: string;
  multiple?: boolean;
  accept?: string;
  testId?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const onDrop = async (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length > 0) onFiles(await readFiles(e.dataTransfer.files));
  };
  return (
    <label
      htmlFor={id}
      className={`dropzone${over ? ' dropzone-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <Icon name="upload" size={22} />
      <span className="dropzone-label">{label}</span>
      {hint && <span className="dropzone-hint">{hint}</span>}
      <span className="dropzone-button">ファイルを選ぶ</span>
      <input
        id={id}
        data-testid={testId}
        className="visually-hidden"
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={async (e) => {
          const input = e.currentTarget;
          const list = input.files ? Array.from(input.files) : [];
          input.value = '';
          if (list.length > 0) onFiles(await readFiles(list));
        }}
      />
    </label>
  );
}
