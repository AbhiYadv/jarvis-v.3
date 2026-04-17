import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class MainView extends LitElement {
    static styles = css`
        * {
            font-family: var(--font);
            cursor: default;
            user-select: none;
            box-sizing: border-box;
        }

        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: var(--space-xl) var(--space-lg);
        }

        .form-wrapper {
            width: 100%;
            max-width: 420px;
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
        }

        .page-title {
            font-size: var(--font-size-xl);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--space-xs);
        }

        .page-title .mode-suffix {
            opacity: 0.5;
        }

        .page-subtitle {
            font-size: var(--font-size-sm);
            color: var(--text-muted);
            margin-bottom: var(--space-md);
        }

        /* ── Cloud promo card ── */

        .cloud-promo {
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px 16px;
            border-radius: var(--radius-md);
            border: 1px solid rgba(59, 130, 246, 0.45);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.09) 100%);
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }

        .cloud-promo:hover {
            border-color: rgba(59, 130, 246, 0.65);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.16) 0%, rgba(139, 92, 246, 0.12) 100%);
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.15), 0 0 40px rgba(139, 92, 246, 0.08);
        }

        .cloud-promo-glow {
            position: absolute;
            top: -40%;
            right: -20%;
            width: 120px;
            height: 120px;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
            pointer-events: none;
        }

        .cloud-promo-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .cloud-promo-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .cloud-promo-arrow {
            color: var(--accent);
            font-size: 16px;
            transition: transform 0.2s;
        }

        .cloud-promo:hover .cloud-promo-arrow {
            transform: translateX(2px);
        }

        .cloud-promo-desc {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            line-height: var(--line-height);
        }

        /* ── Form controls ── */

        .form-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .form-label {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        input, select, textarea {
            background: var(--bg-elevated);
            color: var(--text-primary);
            border: 1px solid var(--border);
            padding: 10px 12px;
            width: 100%;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            transition: border-color var(--transition), box-shadow var(--transition);
        }

        input:hover:not(:focus), select:hover:not(:focus), textarea:hover:not(:focus) {
            border-color: var(--text-muted);
        }

        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }

        input::placeholder, textarea::placeholder {
            color: var(--text-muted);
        }

        input.error {
            border-color: var(--danger, #EF4444);
        }

        select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
            background-position: right 8px center;
            background-repeat: no-repeat;
            background-size: 14px;
            padding-right: 28px;
        }

        textarea {
            resize: vertical;
            min-height: 80px;
            line-height: var(--line-height);
        }

        .form-hint {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }

        .form-hint a, .form-hint span.link {
            color: var(--accent);
            text-decoration: none;
            cursor: pointer;
        }

        .form-hint span.link:hover {
            text-decoration: underline;
        }

        .whisper-label-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .whisper-spinner {
            width: 12px;
            height: 12px;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: whisper-spin 0.8s linear infinite;
        }

        @keyframes whisper-spin {
            to { transform: rotate(360deg); }
        }

        /* ── Start button ── */

        .start-button {
            position: relative;
            overflow: hidden;
            background: #e8e8e8;
            color: #111111;
            border: none;
            padding: 12px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
        }

        .start-button canvas.btn-aurora {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
        }

        .start-button canvas.btn-dither {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            opacity: 0.1;
            mix-blend-mode: overlay;
            pointer-events: none;
            image-rendering: pixelated;
        }

        .start-button .btn-label {
            position: relative;
            z-index: 2;
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .start-button:hover {
            opacity: 0.9;
        }

        .start-button.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .start-button.disabled:hover {
            opacity: 0.5;
        }

        .shortcut-hint {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            opacity: 0.5;
            font-family: var(--font-mono);
        }

        /* ── Divider ── */

        .divider {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            margin: var(--space-sm) 0;
        }

        .divider-line {
            flex: 1;
            height: 1px;
            background: var(--border);
        }

        .divider-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            text-transform: lowercase;
        }

        /* ── Mode switch links ── */

        .mode-links {
            display: flex;
            justify-content: center;
            gap: var(--space-lg);
        }

        .mode-link {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            transition: color var(--transition);
        }

        .mode-link:hover {
            color: var(--text-primary);
        }

        /* ── Mode option cards ── */

        .mode-cards {
            display: flex;
            gap: var(--space-sm);
        }

        .mode-card {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px 14px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
        }

        .mode-card:hover {
            border-color: var(--text-muted);
            background: var(--bg-hover);
        }

        .mode-card-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .mode-card-desc {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            line-height: var(--line-height);
        }

        /* ── Title row with help ── */

        .title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-xs);
        }

        .title-row .page-title {
            margin-bottom: 0;
        }

        .help-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: var(--radius-sm);
            transition: color 0.2s;
            display: flex;
            align-items: center;
        }

        .help-btn:hover {
            color: var(--text-secondary);
        }

        .help-btn * {
            pointer-events: none;
        }

        /* ── Help content ── */

        .help-content {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            max-height: 500px;
            overflow-y: auto;
        }

        .help-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .help-section-title {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .help-section-text {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            line-height: var(--line-height);
        }

        .help-code {
            font-family: var(--font-mono);
            font-size: 11px;
            background: var(--bg-hover);
            padding: 6px 8px;
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            display: block;
        }

        .help-link {
            color: var(--accent);
            cursor: pointer;
            text-decoration: none;
        }

        .help-link:hover {
            text-decoration: underline;
        }

        .help-models {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .help-model {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            display: flex;
            justify-content: space-between;
        }

        .help-model-name {
            font-family: var(--font-mono);
            font-size: 11px;
            color: var(--text-primary);
        }

        .help-divider {
            border: none;
            border-top: 1px solid var(--border);
            margin: 0;
        }

        .help-cloud-btn {
            background: #e8e8e8;
            color: #111111;
            border: none;
            padding: 10px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            transition: opacity 0.15s;
        }

        .help-cloud-btn:hover {
            opacity: 0.9;
        }

        .help-warn {
            font-size: var(--font-size-xs);
            color: var(--warning);
            line-height: var(--line-height);
        }
    `;

    static properties = {
        onStart: { type: Function },
        onExternalLink: { type: Function },
        selectedProfile: { type: String },
        onProfileChange: { type: Function },
        isInitializing: { type: Boolean },
        whisperDownloading: { type: Boolean },
        // Internal state
        _mode: { state: true },
        _planType: { state: true }, // 'welcome' | 'free' | 'plan'
        _token: { state: true },
        _geminiKey: { state: true },
        _groqKey: { state: true },
        _claudeKey: { state: true },
        _openaiKey: { state: true },
        _tokenError: { state: true },
        _keyError: { state: true },
        // Pro plan state
        _proActivated: { state: true },
        _proModel: { state: true },
        _proSessions: { state: true },
        _proModelError: { state: true },
        // Local AI state
        _ollamaHost: { state: true },
        _ollamaModel: { state: true },
        _whisperModel: { state: true },
        _showLocalHelp: { state: true },
    };

    constructor() {
        super();
        this.onStart = () => {};
        this.onExternalLink = () => {};
        this.selectedProfile = 'interview';
        this.onProfileChange = () => {};
        this.isInitializing = false;
        this.whisperDownloading = false;

        this._mode = 'cloud';
        this._planType = 'welcome'; // Start on welcome screen
        this._token = '';
        this._geminiKey = '';
        this._groqKey = '';
        this._claudeKey = '';
        this._openaiKey = '';
        this._tokenError = false;
        this._keyError = false;
        this._proActivated = false;
        this._proModel = 'gemini';
        this._proSessions = 0;
        this._proModelError = false;
        this._showLocalHelp = false;
        this._ollamaHost = 'http://127.0.0.1:11434';
        this._ollamaModel = 'llama3.1';
        this._whisperModel = 'Xenova/whisper-small';

        this._animId = null;
        this._time = 0;
        this._mouseX = -1;
        this._mouseY = -1;

        this.boundKeydownHandler = this._handleKeydown.bind(this);
        this._loadFromStorage();
    }

    async _loadFromStorage() {
        try {
            const [prefs, creds] = await Promise.all([
                jarvis.storage.getPreferences(),
                jarvis.storage.getCredentials().catch(() => ({})),
            ]);

            this._mode = prefs.providerMode || 'cloud';

            // Restore plan type from storage; skip welcome if already chose
            const savedPlanType = prefs.planType || 'welcome';
            this._planType = savedPlanType;

            // Load keys
            this._token = creds.cloudToken || '';
            this._geminiKey = await jarvis.storage.getApiKey().catch(() => '') || '';
            this._groqKey = await jarvis.storage.getGroqApiKey().catch(() => '') || '';
            this._claudeKey = await jarvis.storage.getClaudeApiKey().catch(() => '') || '';
            this._openaiKey = await jarvis.storage.getOpenaiApiKey().catch(() => '') || '';

            // Load local AI settings
            this._ollamaHost = prefs.ollamaHost || 'http://127.0.0.1:11434';
            this._ollamaModel = prefs.ollamaModel || 'llama3.1';
            this._whisperModel = prefs.whisperModel || 'Xenova/whisper-small';

            // Load Pro plan state
            if (creds.proLicense && creds.proLicense.token) {
                this._token = creds.proLicense.token;
                if (window.require) {
                    const ipcRenderer = window.require('electron').ipcRenderer;
                    const validation = await ipcRenderer.invoke('validate-license', this._token).catch(() => ({ valid: false }));
                    this._proActivated = validation.valid;
                }
            }
            if (window.require) {
                const ipcRenderer = window.require('electron').ipcRenderer;
                const modelResult = await ipcRenderer.invoke('get-pro-model').catch(() => ({ model: 'gemini' }));
                this._proModel = modelResult.model || 'gemini';
                const sessResult = await ipcRenderer.invoke('get-daily-sessions').catch(() => ({ count: 0 }));
                this._proSessions = sessResult.count || 0;
            }

            this.requestUpdate();
        } catch (e) {
            console.error('Error loading MainView storage:', e);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('keydown', this.boundKeydownHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('keydown', this.boundKeydownHandler);
        if (this._animId) cancelAnimationFrame(this._animId);
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        const hasButton = this._planType === 'free' || this._planType === 'plan';
        if (changedProperties.has('_mode') || changedProperties.has('_planType')) {
            if (this._animId) {
                cancelAnimationFrame(this._animId);
                this._animId = null;
            }
            if (hasButton) {
                this._initButtonAurora();
            }
        }
        if (!this._animId && hasButton) {
            this._initButtonAurora();
        }
    }

    _initButtonAurora() {
        const btn = this.shadowRoot.querySelector('.start-button');
        const aurora = this.shadowRoot.querySelector('canvas.btn-aurora');
        const dither = this.shadowRoot.querySelector('canvas.btn-dither');
        if (!aurora || !dither || !btn) return;

        // Mouse tracking
        this._mouseX = -1;
        this._mouseY = -1;
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            this._mouseX = (e.clientX - rect.left) / rect.width;
            this._mouseY = (e.clientY - rect.top) / rect.height;
        });
        btn.addEventListener('mouseleave', () => {
            this._mouseX = -1;
            this._mouseY = -1;
        });

        // Dither
        const blockSize = 8;
        const cols = Math.ceil(aurora.offsetWidth / blockSize);
        const rows = Math.ceil(aurora.offsetHeight / blockSize);
        dither.width = cols;
        dither.height = rows;
        const dCtx = dither.getContext('2d');
        const img = dCtx.createImageData(cols, rows);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.random() > 0.5 ? 255 : 0;
            img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255;
        }
        dCtx.putImageData(img, 0, 0);

        // Aurora
        const ctx = aurora.getContext('2d');
        const scale = 0.4;
        aurora.width = Math.floor(aurora.offsetWidth * scale);
        aurora.height = Math.floor(aurora.offsetHeight * scale);

        const blobs = [
            { color: [120, 160, 230], x: 0.1, y: 0.3, vx: 0.25, vy: 0.2, phase: 0 },
            { color: [150, 120, 220], x: 0.8, y: 0.5, vx: -0.2, vy: 0.25, phase: 1.5 },
            { color: [200, 140, 210], x: 0.5, y: 0.6, vx: 0.18, vy: -0.22, phase: 3.0 },
            { color: [100, 190, 190], x: 0.3, y: 0.7, vx: 0.3, vy: 0.15, phase: 4.5 },
            { color: [220, 170, 130], x: 0.7, y: 0.4, vx: -0.22, vy: -0.25, phase: 6.0 },
        ];

        const draw = () => {
            this._time += 0.008;
            const w = aurora.width;
            const h = aurora.height;
            const maxDim = Math.max(w, h);

            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(0, 0, w, h);

            const hovering = this._mouseX >= 0;

            for (const blob of blobs) {
                const t = this._time;
                const cx = (blob.x + Math.sin(t * blob.vx + blob.phase) * 0.4) * w;
                const cy = (blob.y + Math.cos(t * blob.vy + blob.phase * 0.7) * 0.4) * h;
                const r = maxDim * 0.45;

                let boost = 1;
                if (hovering) {
                    const dx = cx / w - this._mouseX;
                    const dy = cy / h - this._mouseY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    boost = 1 + 2.5 * Math.max(0, 1 - dist / 0.6);
                }

                const a0 = Math.min(1, 0.18 * boost);
                const a1 = Math.min(1, 0.08 * boost);
                const a2 = Math.min(1, 0.02 * boost);

                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                grad.addColorStop(0, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${a0})`);
                grad.addColorStop(0.3, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${a1})`);
                grad.addColorStop(0.6, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${a2})`);
                grad.addColorStop(1, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, 0)`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            }

            this._animId = requestAnimationFrame(draw);
        };

        draw();
    }

    _handleKeydown(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            this._handleStart();
        }
    }

    // ── Persistence ──

    async _selectPlan(planType) {
        this._planType = planType;
        await jarvis.storage.updatePreference('planType', planType);
        // Map plan type to internal provider mode
        if (planType === 'free') {
            await this._saveMode('byok');
        } else if (planType === 'plan') {
            await this._saveMode('cloud');
        }
        this.requestUpdate();
    }

    async _saveMode(mode) {
        this._mode = mode;
        this._tokenError = false;
        this._keyError = false;
        await jarvis.storage.updatePreference('providerMode', mode);
        this.requestUpdate();
    }

    async _saveToken(val) {
        this._token = val;
        this._tokenError = false;
        try {
            const creds = await jarvis.storage.getCredentials().catch(() => ({}));
            await jarvis.storage.setCredentials({ ...creds, cloudToken: val });
        } catch (e) {}
        this.requestUpdate();
    }

    async _saveGeminiKey(val) {
        this._geminiKey = val;
        this._keyError = false;
        await jarvis.storage.setApiKey(val);
        this.requestUpdate();
    }

    async _saveGroqKey(val) {
        this._groqKey = val;
        await jarvis.storage.setGroqApiKey(val);
        this.requestUpdate();
    }

    async _saveClaudeKey(val) {
        this._claudeKey = val;
        await jarvis.storage.setClaudeApiKey(val);
        this.requestUpdate();
    }

    async _saveOpenaiKey(val) {
        this._openaiKey = val;
        await jarvis.storage.setOpenaiApiKey(val);
        this.requestUpdate();
    }

    async _saveOllamaHost(val) {
        this._ollamaHost = val;
        await jarvis.storage.updatePreference('ollamaHost', val);
        this.requestUpdate();
    }

    async _saveOllamaModel(val) {
        this._ollamaModel = val;
        await jarvis.storage.updatePreference('ollamaModel', val);
        this.requestUpdate();
    }

    async _saveWhisperModel(val) {
        this._whisperModel = val;
        await jarvis.storage.updatePreference('whisperModel', val);
        this.requestUpdate();
    }

    _handleProfileChange(e) {
        this.onProfileChange(e.target.value);
    }

    // ── Start ──

    _handleStart() {
        if (this.isInitializing) return;

        if (this._planType === 'plan') {
            if (!this._proActivated || !this._token.trim()) {
                this._tokenError = true;
                this.requestUpdate();
                return;
            }
        } else if (this._planType === 'free' || this._mode === 'byok') {
            if (!this._geminiKey.trim()) {
                this._keyError = true;
                this.requestUpdate();
                return;
            }
        } else if (this._mode === 'local') {
            if (!this._ollamaHost.trim()) {
                return;
            }
        }

        this.onStart();
    }

    triggerApiKeyError() {
        if (this._planType === 'plan' || this._mode === 'cloud') {
            this._tokenError = true;
        } else {
            this._keyError = true;
        }
        this.requestUpdate();
        setTimeout(() => {
            this._tokenError = false;
            this._keyError = false;
            this.requestUpdate();
        }, 2000);
    }

    // ── Render helpers ──

    _renderStartButton() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

        const cmdIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>`;
        const ctrlIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>`;
        const enterIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10l-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>`;

        return html`
            <button
                class="start-button ${this.isInitializing ? 'disabled' : ''}"
                @click=${() => this._handleStart()}
            >
                <canvas class="btn-aurora"></canvas>
                <canvas class="btn-dither"></canvas>
                <span class="btn-label">
                    Start Session
                    <span class="shortcut-hint">${isMac ? cmdIcon : ctrlIcon}${enterIcon}</span>
                </span>
            </button>
        `;
    }

    _renderDivider() {
        return html`
            <div class="divider">
                <div class="divider-line"></div>
                <span class="divider-text">or</span>
                <div class="divider-line"></div>
            </div>
        `;
    }

    // ── Welcome / plan selection screen ──

    _renderWelcome() {
        return html`
            <div class="page-title">Welcome to Jarvis</div>
            <div class="page-subtitle">Stealth AI assistant — invisible to screen share</div>

            <div class="mode-cards" style="flex-direction: column; gap: 12px; margin-top: 8px;">
                <div class="mode-card" style="padding: 18px 20px; border-color: rgba(59,130,246,0.3);" @click=${() => this._selectPlan('free')}>
                    <span class="mode-card-title" style="font-size: 15px;">Free</span>
                    <span class="mode-card-desc">Use your own Gemini API key — full stealth features, always on top, transparent overlay</span>
                    <span class="mode-card-desc" style="color: var(--accent); margin-top: 4px;">Get started →</span>
                </div>
                <div class="mode-card" style="padding: 18px 20px;" @click=${() => this._selectPlan('plan')}>
                    <span class="mode-card-title" style="font-size: 15px;">Pro Plan</span>
                    <span class="mode-card-desc">Jarvis Cloud — no API keys needed, managed service, priority support</span>
                    <span class="mode-card-desc" style="margin-top: 4px;">Enter invite code →</span>
                </div>
            </div>
        `;
    }

    // ── Free mode (Gemini required, GPT/Claude optional) ──

    _renderFreeMode() {
        return html`
            <div class="form-group">
                <label class="form-label">Gemini API Key <span style="color:var(--danger,#EF4444);font-weight:400">*required</span></label>
                <input
                    type="password"
                    placeholder="Required — fallback for all responses"
                    .value=${this._geminiKey}
                    @input=${e => this._saveGeminiKey(e.target.value)}
                    class=${this._keyError ? 'error' : ''}
                />
                <div class="form-hint">
                    <span class="link" @click=${() => this.onExternalLink('https://aistudio.google.com/apikey')}>Get free Gemini key</span>
                    &nbsp;— always-on fallback
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">GPT API Key <span style="opacity:0.5;font-weight:400">(optional — primary)</span></label>
                <input
                    type="password"
                    placeholder="GPT-4o for voice + analyze if provided"
                    .value=${this._openaiKey}
                    @input=${e => this._saveOpenaiKey(e.target.value)}
                />
                <div class="form-hint">
                    <span class="link" @click=${() => this.onExternalLink('https://platform.openai.com/api-keys')}>Get OpenAI key</span>
                    &nbsp;— invoked first when set
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Claude API Key <span style="opacity:0.5;font-weight:400">(optional — secondary)</span></label>
                <input
                    type="password"
                    placeholder="Claude Sonnet if GPT not set"
                    .value=${this._claudeKey}
                    @input=${e => this._saveClaudeKey(e.target.value)}
                />
                <div class="form-hint">
                    <span class="link" @click=${() => this.onExternalLink('https://console.anthropic.com/settings/keys')}>Get Claude key</span>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Groq API Key <span style="opacity:0.5;font-weight:400">(optional — faster STT)</span></label>
                <input
                    type="password"
                    placeholder="Enables fast Whisper voice transcription"
                    .value=${this._groqKey}
                    @input=${e => this._saveGroqKey(e.target.value)}
                />
                <div class="form-hint">
                    <span class="link" @click=${() => this.onExternalLink('https://console.groq.com/keys')}>Get Groq key</span>
                </div>
            </div>

            ${this._renderStartButton()}
            ${this._renderDivider()}

            <div class="cloud-promo" @click=${() => this._selectPlan('plan')}>
                <div class="cloud-promo-glow"></div>
                <div class="cloud-promo-header">
                    <span class="cloud-promo-title">Upgrade to Pro Plan</span>
                    <span class="cloud-promo-arrow">&rarr;</span>
                </div>
                <div class="cloud-promo-desc">No API keys, no setup. Jarvis Cloud handles everything.</div>
            </div>

            <div class="mode-links">
                <button class="mode-link" @click=${() => this._selectPlan('welcome')}>&larr; Back</button>
            </div>
        `;
    }

    // ── Plan (cloud) mode ──

    _renderPlanMode() {
        if (!this._proActivated) {
            return html`
                <div class="page-title">Pro Plan</div>
                <div class="page-subtitle">Enter your license key to activate</div>

                <div class="form-group">
                    <label class="form-label">License Key</label>
                    <input
                        type="password"
                        placeholder="JARVIS-PRO-..."
                        .value=${this._token}
                        @input=${e => { this._token = e.target.value; this._tokenError = false; }}
                        class=${this._tokenError ? 'error' : ''}
                    />
                    <div class="form-hint">Get a license at jarvis.ai or use test key: JARVIS-PRO-TEST-0001</div>
                </div>

                <button class="start-button" @click=${() => this._activateLicense()}>
                    <span class="btn-label">Activate License</span>
                </button>

                <div class="mode-links">
                    <button class="mode-link" @click=${() => this._selectPlan('welcome')}>&larr; Back</button>
                </div>
            `;
        }

        return html`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <div class="page-title" style="margin-bottom:0">Pro Plan</div>
                <span style="font-size:11px;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:4px;padding:2px 8px;font-family:var(--font-mono)">ACTIVE</span>
            </div>
            <div class="page-subtitle">Choose your AI model and start</div>

            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border);font-size:12px">
                <span style="color:var(--text-secondary)">Sessions today</span>
                <span style="font-family:var(--font-mono);color:var(--text-primary)">${this._proSessions} / 50</span>
            </div>

            <div class="form-group">
                <label class="form-label">AI Model</label>
                <div style="display:flex;flex-direction:column;gap:8px">
                    ${[
                        { id: 'gemini', label: 'Gemini 2.5 Flash', desc: 'Fast, multimodal, great for interviews', badge: 'Recommended' },
                        { id: 'claude', label: 'Claude Sonnet 4', desc: 'Best reasoning, nuanced responses' },
                        { id: 'gpt4o', label: 'GPT-4o', desc: 'Versatile, strong coding & analysis' },
                    ].map(m => html`
                        <div
                            style="padding:10px 14px;border-radius:var(--radius-md);border:1px solid ${this._proModel === m.id ? 'var(--accent)' : 'var(--border)'};background:${this._proModel === m.id ? 'rgba(59,130,246,0.08)' : 'var(--bg-elevated)'};cursor:pointer;transition:all 0.15s"
                            @click=${() => this._saveProModel(m.id)}
                        >
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${m.label}</span>
                                ${m.badge ? html`<span style="font-size:10px;background:rgba(59,130,246,0.15);color:var(--accent);border-radius:4px;padding:1px 6px">${m.badge}</span>` : ''}
                                ${this._proModel === m.id ? html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
                            </div>
                            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${m.desc}</div>
                        </div>
                    `)}
                </div>
            </div>

            ${this._renderStartButton()}

            <div class="mode-links">
                <button class="mode-link" @click=${() => { this._proActivated = false; }}>Change key</button>
                <button class="mode-link" @click=${() => this._selectPlan('welcome')}>&larr; Back</button>
            </div>
        `;
    }

    async _activateLicense() {
        if (!this._token.trim()) { this._tokenError = true; this.requestUpdate(); return; }
        const ipcRenderer = window.require('electron').ipcRenderer;
        const result = await ipcRenderer.invoke('validate-license', this._token).catch(() => ({ valid: false }));
        if (result.valid) {
            this._proActivated = true;
            await jarvis.storage.setCredentials({ cloudToken: this._token });
            await jarvis.storage.updatePreference('providerMode', 'cloud');
            this._mode = 'cloud';
        } else {
            this._tokenError = true;
        }
        this.requestUpdate();
    }

    async _saveProModel(model) {
        this._proModel = model;
        const ipcRenderer = window.require('electron').ipcRenderer;
        await ipcRenderer.invoke('set-pro-model', model).catch(() => {});
        this.requestUpdate();
    }

    // ── Local AI mode ──

    _renderLocalMode() {
        return html`
            <div class="form-group">
                <label class="form-label">Ollama Host</label>
                <input
                    type="text"
                    placeholder="http://127.0.0.1:11434"
                    .value=${this._ollamaHost}
                    @input=${e => this._saveOllamaHost(e.target.value)}
                />
                <div class="form-hint">Ollama must be running locally</div>
            </div>

            <div class="form-group">
                <label class="form-label">Ollama Model</label>
                <input
                    type="text"
                    placeholder="llama3.1"
                    .value=${this._ollamaModel}
                    @input=${e => this._saveOllamaModel(e.target.value)}
                />
                <div class="form-hint">Run <code style="font-family: var(--font-mono); font-size: 11px; background: var(--bg-elevated); padding: 1px 4px; border-radius: 3px;">ollama pull ${this._ollamaModel}</code> first</div>
            </div>

            <div class="form-group">
                <div class="whisper-label-row">
                    <label class="form-label">Whisper Model</label>
                    ${this.whisperDownloading ? html`<div class="whisper-spinner"></div>` : ''}
                </div>
                <select
                    .value=${this._whisperModel}
                    @change=${e => this._saveWhisperModel(e.target.value)}
                >
                    <option value="Xenova/whisper-tiny" ?selected=${this._whisperModel === 'Xenova/whisper-tiny'}>Tiny (fastest, least accurate)</option>
                    <option value="Xenova/whisper-base" ?selected=${this._whisperModel === 'Xenova/whisper-base'}>Base</option>
                    <option value="Xenova/whisper-small" ?selected=${this._whisperModel === 'Xenova/whisper-small'}>Small (recommended)</option>
                    <option value="Xenova/whisper-medium" ?selected=${this._whisperModel === 'Xenova/whisper-medium'}>Medium (most accurate, slowest)</option>
                </select>
                <div class="form-hint">${this.whisperDownloading ? 'Downloading model...' : 'Downloaded automatically on first use'}</div>
            </div>

            ${this._renderStartButton()}
            ${this._renderDivider()}

            <div class="cloud-promo" @click=${() => this._selectPlan('plan')}>
                <div class="cloud-promo-glow"></div>
                <div class="cloud-promo-header">
                    <span class="cloud-promo-title">Switch to Pro Plan</span>
                    <span class="cloud-promo-arrow">&rarr;</span>
                </div>
                <div class="cloud-promo-desc">No API keys, no setup, no billing headaches. It just works.</div>
            </div>

            <div class="mode-links">
                <button class="mode-link" @click=${() => this._selectPlan('free')}>Use own API key</button>
                <button class="mode-link" @click=${() => this._selectPlan('welcome')}>&larr; Back</button>
            </div>
        `;
    }

    // ── Main render ──

    render() {
        const helpIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m9 5v.01" /><path d="M12 13.5a1.5 1.5 0 0 1 1-1.5a2.6 2.6 0 1 0-3-4" /></g></svg>`;
        const closeIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12" /></svg>`;

        if (this._planType === 'welcome') {
            return html`<div class="form-wrapper">${this._renderWelcome()}</div>`;
        }

        if (this._mode === 'local') {
            return html`
                <div class="form-wrapper">
                    <div class="title-row">
                        <div class="page-title">Jarvis <span class="mode-suffix">Local AI</span></div>
                        <button class="help-btn" @click=${() => { this._showLocalHelp = !this._showLocalHelp; }}>${this._showLocalHelp ? closeIcon : helpIcon}</button>
                    </div>
                    ${this._showLocalHelp ? this._renderLocalHelp() : this._renderLocalMode()}
                </div>
            `;
        }

        return html`
            <div class="form-wrapper">
                ${this._planType === 'free' ? this._renderFreeMode() : ''}
                ${this._planType === 'plan' ? this._renderPlanMode() : ''}
            </div>
        `;
    }

    _renderLocalHelp() {
        return html`
            <div class="help-content">
                <div class="help-section">
                    <div class="help-section-title">What is Ollama?</div>
                    <div class="help-section-text">Ollama lets you run large language models locally on your machine. Everything stays on your computer — no data leaves your device.</div>
                </div>

                <div class="help-section">
                    <div class="help-section-title">Install Ollama</div>
                    <div class="help-section-text">Download from <span class="help-link" @click=${() => this.onExternalLink('https://ollama.com/download')}>ollama.com/download</span> and install it.</div>
                </div>

                <div class="help-section">
                    <div class="help-section-title">Ollama must be running</div>
                    <div class="help-section-text">Ollama needs to be running before you start a session. If it's not running, open your terminal and type:</div>
                    <code class="help-code">ollama serve</code>
                </div>

                <div class="help-section">
                    <div class="help-section-title">Pull a model</div>
                    <div class="help-section-text">Download a model before first use:</div>
                    <code class="help-code">ollama pull gemma3:4b</code>
                </div>

                <div class="help-section">
                    <div class="help-section-title">Recommended models</div>
                    <div class="help-models">
                        <div class="help-model"><span class="help-model-name">gemma3:4b</span><span>4B — fast, multimodal (images + text)</span></div>
                        <div class="help-model"><span class="help-model-name">mistral-small</span><span>8B — solid all-rounder, text only</span></div>
                    </div>
                    <div class="help-section-text">gemma3:4b and above supports images — screenshots will work with these models.</div>
                </div>

                <div class="help-section">
                    <div class="help-warn">Avoid "thinking" models (e.g. deepseek-r1, qwq). Local inference is already slower — a thinking model adds extra delay before responding.</div>
                </div>

                <div class="help-section">
                    <div class="help-section-title">Whisper</div>
                    <div class="help-section-text">The Whisper speech-to-text model is downloaded automatically the first time you start a session. This is a one-time download.</div>
                </div>

                <hr class="help-divider" />

                <div class="help-section">
                    <div class="help-section-title">Computer hanging or slow?</div>
                    <div class="help-section-text">Running models locally uses a lot of RAM and CPU. If your computer slows down or freezes, it's likely the LLM. Cloud mode gives you faster, better responses without any load on your machine.</div>
                </div>

                <button class="help-cloud-btn" @click=${() => { this._showLocalHelp = false; this._selectPlan('plan'); }}>Switch to Pro Plan</button>
            </div>
        `;
    }
}

customElements.define('main-view', MainView);
