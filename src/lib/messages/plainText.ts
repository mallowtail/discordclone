/**
 * True when a message has nothing the Markdown formatter would change, so it can be shown as-is.
 * Formatting the whole list is the main cost of opening a chat; most messages are plain sentences.
 * Deliberately conservative: any character that can start formatting, a mention, a link, an HTML
 * entity or a line break sends it through the real formatter.
 */
const SPECIAL = /[*_~`[\]()#>|!<\\@&:\n\r]/;
const LIST_START = /^\s*(\d+[.)]|[-+])\s/;

export function isPlainText(text: string): boolean {
  return text.length > 0 && !SPECIAL.test(text) && !LIST_START.test(text);
}
