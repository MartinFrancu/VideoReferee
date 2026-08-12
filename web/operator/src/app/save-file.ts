/**
 * Putting a file somewhere the operator chose.
 *
 * `showSaveFilePicker` gives a real save-as dialog — a name they can change and
 * a folder they pick — but only Chrome and Edge have it. Everywhere else the
 * file still downloads to wherever downloads go, which is what happened before
 * and is no worse than it was.
 */

interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
}

/**
 * Write `blob` somewhere, and answer the name it was written as — or null if
 * the operator changed their mind, which is not a failure and should be silent.
 */
export async function saveBlobAs(blob: Blob, suggestedName: string): Promise<string | null> {
  const picker = (window as unknown as FilePickerWindow).showSaveFilePicker;

  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker.call(window, {
        suggestedName,
        types: [{ description: 'VideoReferee session', accept: { 'application/json': ['.json'] } }],
      });
    } catch (error) {
      // The picker throws AbortError when dismissed. Anything else is real.
      if ((error as { name?: string })?.name === 'AbortError') return null;
      throw error;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle.name;
  }

  // No picker here. The anchor is created, clicked and dropped in one go, so
  // nothing can remove it while the download is starting.
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return suggestedName;
}
