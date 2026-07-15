export const listWindowStart = (count: number, selectedIndex: number, capacity: number): number => {
  if (count <= capacity) {
    return 0
  }
  return Math.min(Math.max(0, selectedIndex - capacity + 1), count - capacity)
}
