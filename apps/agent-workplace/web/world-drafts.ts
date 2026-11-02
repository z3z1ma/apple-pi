const dirtyOwners = new Set<object>();

export function setWorldDraftDirty(owner: object, dirty: boolean): void {
	if (dirty) dirtyOwners.add(owner);
	else dirtyOwners.delete(owner);
	window.frameElement?.toggleAttribute("data-world-dirty", dirtyOwners.size > 0);
}
