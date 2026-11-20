// Executable paths are application source, never fields in a manifest or imported JSON.
export const loaders = Object.freeze({
  today: () => import('./widgets/today.js'),
  projects: () => import('./widgets/projects.js'),
  focus: () => import('./widgets/focus.js'),
  agents: () => import('./widgets/pending.js'),
  reader: () => import('./widgets/pending.js'),
  github: () => import('./widgets/pending.js'),
  familiars: () => import('./widgets/pending.js'),
  'local-media': () => import('./widgets/pending.js'),
  desktops: () => import('./widgets/pending.js'),
  transcription: () => import('./widgets/pending.js'),
  shells: () => import('./widgets/shells.js'),
  declarative: () => import('./widgets/declarative.js'),
});
export const styles = Object.freeze({
  today: './widgets/views.css', projects: './widgets/views.css', focus: './widgets/views.css',
  shells: './widgets/shells.css', declarative: './widgets/declarative.css',
});
