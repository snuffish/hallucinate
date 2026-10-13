import { useUI } from '../app/AppContext';

export function Toast() {
  const toast = useUI((ui) => ui.toast);
  return <div id="toast" className={`toast${toast ? ' show' : ''}`} role="status">{toast?.text ?? ''}</div>;
}
