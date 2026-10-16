// Fake @forge/object-store: never reached by the workflow paths; present so imports resolve.
export const objectStore = {
  createUploadUrl: async () => { throw new Error("fake object-store: not implemented"); },
  createDownloadUrl: async () => { throw new Error("fake object-store: not implemented"); },
  delete: async () => {},
};
