// The tag menu's chunk (TagCommand.tsx), in its own module so TagMenu.tsx exports only components (fast refresh).
export const loadTagCommand = () => import("./TagCommand");
