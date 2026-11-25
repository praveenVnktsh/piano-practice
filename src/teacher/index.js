// The Teacher (docs/ARCHITECTURE.md, "Teacher hooks"): src/main.js mounts it lazily.
// Conversation lives on the dev server (teacher/plugin.js); see teacher/prompt.md.
import './teacher.css';
import {createPanel} from './panel.js';

let mounted = null;

/** Adds the Teacher button and panel to `root` (once) → {destroy()}. */
export function mountTeacher(root = document.body) {
  if (!mounted) {
    mounted = createPanel(root);
    const destroy = mounted.destroy;
    mounted.destroy = () => {
      destroy();
      mounted = null;
    };
  }
  return mounted;
}
