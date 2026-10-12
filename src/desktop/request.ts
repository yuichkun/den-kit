/** IPC failures must not leave a settings operation loading indefinitely. */
export async function desktopRequest<T>(operation: Promise<T>, timeoutMs = 90000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The operation timed out. Try again.')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
