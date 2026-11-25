import './styles/tokens.css';
import './styles/app.css';
import './styles/shell.css';
import {startApp} from './app/index.js';
import {installErrorReporting} from './errors/reporter.js';
import {onMac} from './app/mac.js';

// Uncaught errors → the dev server's /__errors (error-log/plugin.js); not on a static site.
if (onMac()) installErrorReporting({endpoint: (import.meta.env.BASE_URL || '/') + '__errors'});

startApp();

// AI teacher (src/teacher/, docs/ARCHITECTURE.md "Teacher hooks"): mounted lazily, and the
// app works without it. import.meta.glob is `import('./teacher/index.js')` that also builds
// and serves cleanly while the module doesn't exist yet (→ {}).
const teacher = import.meta.glob('./teacher/index.js')['./teacher/index.js'];
// The teacher lives on the Mac (dev server): nothing to mount on a static site.
(teacher && onMac() ? teacher() : Promise.reject(Error('no teacher module')))
  .then(m => m.mountTeacher(document.body))
  .catch(() => {});
