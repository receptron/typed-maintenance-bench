export const MAX_STAGE = 7;

export const parseStageRange = (text: string): number[] => {
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  const [first, last] = [Number(match?.[1]), Number(match?.[2] ?? match?.[1])];
  if (match === null || first < 1 || last > MAX_STAGE || first > last)
    throw new Error(`--stages must be within 1-${MAX_STAGE}`);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
};
