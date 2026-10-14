// In-app dialogs and dialog keyboard behavior.
//
// UI.alert / UI.confirm / UI.prompt replace the browser's alert(),
// confirm() and prompt() with a dialog in the app's own style. Each returns
// a promise: alert → undefined, confirm → true/false, prompt → the text or
// null when canceled. UI.choose has a second answer (alt): 'ok', 'alt'
// or null.
//
// Every .dialog-overlay also gets, without its own code having to ask:
// focus moved into it when it opens, Tab kept inside it while open, and
// focus handed back to where it was when it closes.

const UI = {
    _stack: [],      // open overlays, newest last
    _pending: null,  // the alert/confirm/prompt being answered

    el(id) { return document.getElementById(id); },

    init() {
        if (this._inited) return;
        this._inited = true;
        const overlays = [...document.querySelectorAll('.dialog-overlay')];
        const watch = new MutationObserver((records) => {
            for (const r of records) this.sync(r.target);
        });
        overlays.forEach(o => {
            watch.observe(o, { attributes: true, attributeFilter: ['class'] });
            if (!o.classList.contains('hidden')) this.sync(o);
        });
        document.addEventListener('keydown', (e) => this.trapTab(e), true);

        // alert / confirm / prompt
        const box = this.el('ui-dialog');
        this.el('uid-ok').addEventListener('click', () => this.answer(true));
        this.el('uid-cancel').addEventListener('click', () => this.answer(false));
        this.el('uid-alt').addEventListener('click', () => this.answer('alt'));
        box.addEventListener('mousedown', (e) => {
            if (e.target === box) this.answer(false);
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.answer(false);
            } else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) {
                e.preventDefault();
                e.stopPropagation();
                this.answer(true);
            }
        });
    },

    // ---- Focus handling for every dialog ----

    sync(overlay) {
        const open = !overlay.classList.contains('hidden');
        const i = this._stack.findIndex(s => s.overlay === overlay);
        if (open && i === -1) {
            this._stack.push({ overlay, returnTo: document.activeElement });
            // After the dialog's own code has had a chance to focus a field
            requestAnimationFrame(() => {
                if (overlay.classList.contains('hidden') || overlay.contains(document.activeElement)) return;
                const target = overlay.querySelector('[autofocus]') ||
                    overlay.querySelector('.dialog-body input:not([type="hidden"]):not([disabled]), .dialog-body select, .dialog-body textarea') ||
                    overlay.querySelector('.dialog-foot .btn.primary:not(:disabled)') ||
                    this.focusables(overlay)[0];
                if (target) target.focus({ preventScroll: true });
            });
        } else if (!open && i !== -1) {
            const [{ returnTo }] = this._stack.splice(i, 1);
            const lost = !document.activeElement || document.activeElement === document.body || overlay.contains(document.activeElement);
            if (lost && returnTo && returnTo.isConnected && typeof returnTo.focus === 'function') {
                returnTo.focus({ preventScroll: true });
            }
        }
    },

    focusables(root) {
        return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(el => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
    },

    top() {
        for (let i = this._stack.length - 1; i >= 0; i--) {
            const o = this._stack[i].overlay;
            if (!o.classList.contains('hidden')) return o;
        }
        return null;
    },

    trapTab(e) {
        if (e.key !== 'Tab') return;
        const overlay = this.top();
        if (!overlay) return;
        const items = this.focusables(overlay);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        const inside = overlay.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
            e.preventDefault();
            first.focus();
        }
    },

    // Is one of the dialogs this file manages (alert/confirm/prompt or
    // Settings) open? The app's own shortcuts stand aside while it is.
    isOpen() {
        return !this.el('ui-dialog').classList.contains('hidden') ||
            !this.el('settings-panel').classList.contains('hidden');
    },

    // ---- alert / confirm / prompt ----

    // opts: { title, message, items: [text], note, ok, cancel, danger, input: { label, value, placeholder, inputMode },
    //        alt, altDanger (choose) }
    // Text only, never HTML: file names go in safely.
    show(kind, opts) {
        this.init();
        if (this._pending) this.answer(false); // one at a time
        const o = typeof opts === 'string' ? { message: opts } : (opts || {});
        this.el('uid-title').textContent = o.title || (kind === 'alert' ? 'jEditor' : 'Are you sure?');
        const text = this.el('uid-text');
        text.textContent = '';
        String(o.message || '').split(/\n{2,}/).filter(Boolean).forEach(para => {
            const p = document.createElement('p');
            p.textContent = para;
            text.appendChild(p);
        });
        if (o.items && o.items.length) {
            const ul = document.createElement('ul');
            o.items.forEach(t => {
                const li = document.createElement('li');
                li.textContent = t;
                ul.appendChild(li);
            });
            text.appendChild(ul);
        }
        if (o.note) {
            const p = document.createElement('p');
            const b = document.createElement('strong');
            b.textContent = o.note;
            p.appendChild(b);
            text.appendChild(p);
        }
        text.classList.toggle('hidden', !text.childNodes.length);

        const field = this.el('uid-field');
        const input = this.el('uid-input');
        field.classList.toggle('hidden', kind !== 'prompt');
        if (kind === 'prompt') {
            const f = o.input || {};
            this.el('uid-field-label').textContent = f.label || '';
            input.value = f.value || '';
            input.placeholder = f.placeholder || '';
            input.inputMode = f.inputMode || 'text';
        }

        const ok = this.el('uid-ok');
        const cancel = this.el('uid-cancel');
        ok.textContent = o.ok || 'OK';
        ok.className = 'btn ' + (o.danger ? 'danger' : 'primary');
        cancel.textContent = o.cancel || 'Cancel';
        cancel.classList.toggle('hidden', kind === 'alert');
        const alt = this.el('uid-alt');
        alt.textContent = o.alt || '';
        alt.className = 'btn ' + (o.altDanger ? 'danger' : 'secondary');
        alt.classList.toggle('hidden', kind !== 'choose');

        const box = this.el('ui-dialog');
        box.querySelector('.dialog').setAttribute('role', kind === 'alert' || o.danger ? 'alertdialog' : 'dialog');
        box.classList.remove('hidden');
        // A destructive confirm starts on Cancel, so Enter can't destroy by accident
        requestAnimationFrame(() => {
            if (kind === 'prompt') { input.focus(); input.select(); }
            else (o.danger ? cancel : ok).focus();
        });
        return new Promise(resolve => { this._pending = { kind, resolve }; });
    },

    answer(yes) {
        const p = this._pending;
        if (!p) return;
        this._pending = null;
        this.el('ui-dialog').classList.add('hidden');
        if (p.kind === 'alert') p.resolve();
        else if (p.kind === 'confirm') p.resolve(!!yes);
        else if (p.kind === 'choose') p.resolve(yes === 'alt' ? 'alt' : yes ? 'ok' : null);
        else p.resolve(yes ? this.el('uid-input').value : null);
    },

    alert(opts) { return this.show('alert', opts); },
    confirm(opts) { return this.show('confirm', opts); },
    choose(opts) { return this.show('choose', opts); },
    prompt(opts) { return this.show('prompt', opts); }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => UI.init());
else UI.init();
