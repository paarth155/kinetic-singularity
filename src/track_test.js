// Mock tracking logic to test
const currentHandsInfo = [
    { cx: 0.2, proposedHand: 'Left' }, // physically Right hand, but MP says Left
    { cx: 0.8, proposedHand: 'Left' }  // physically Left hand, MP says Left
];
const unassignedPrev = new Set(['Left', 'Right']);

// Conflict resolution for first frame
if (currentHandsInfo.length === 2 && currentHandsInfo[0].proposedHand === currentHandsInfo[1].proposedHand) {
    // If MP gives same label to both, use X coordinate
    const rightIdx = currentHandsInfo[0].cx < currentHandsInfo[1].cx ? 0 : 1;
    currentHandsInfo[rightIdx].proposedHand = 'Right';
    currentHandsInfo[1-rightIdx].proposedHand = 'Left';
}

for (const curr of currentHandsInfo) {
    if (unassignedPrev.has(curr.proposedHand)) {
        curr.assigned = curr.proposedHand;
        unassignedPrev.delete(curr.proposedHand);
    }
}
console.log(currentHandsInfo);
