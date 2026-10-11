/** Open the browser only for the expected OAuth host; unwind a failed launch. */
export async function openChatGPTSignIn(
  account: { signIn(): Promise<string>; cancelSignIn(): Promise<void> },
  openExternal: (url: string) => Promise<unknown>,
) {
  const url = await account.signIn();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'auth.openai.com') throw new Error('Unexpected ChatGPT sign-in address.');
    await openExternal(url);
  } catch {
    await account.cancelSignIn().catch(() => undefined);
    throw new Error('The sign-in page could not be opened in your browser. Try again.');
  }
}
