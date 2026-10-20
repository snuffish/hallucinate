// "1 scene", "3 scenes": a count and its noun, for messages and labels. English plurals in -s only.
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
