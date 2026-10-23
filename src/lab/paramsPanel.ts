import { DiscardParams } from '../ui3d/discardMotion';
import {
  BUILTIN_PRESETS,
  PARAM_KEYS,
  PARAM_SPECS,
  Preset,
  exportPreset,
  loadDraft,
  loadUserPresets,
  parsePresets,
  sameParams,
  saveDraft,
  saveUserPresets,
} from './presets';

// 动作参数面板：选预设，拖滑块或者直接填数字实时改参数，存成自己的预设，导出导入 JSON。
// params 是正在用的那一份参数，调试场景出牌时直接引用它，改了马上生效。

type Io = 'none' | 'saveas' | 'export' | 'import';

const decimals = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class ParamsPanel {
  readonly params: DiscardParams;
  private presetName: string;
  private user: Preset[] = loadUserPresets();
  private io: Io = 'none';
  private msg = '';
  private confirmDelete = false;

  // change(structural)：structural 为真表示整套换了（换预设、导入、恢复），否则是拖了一个滑块
  constructor(
    private el: HTMLElement,
    private onChange: (structural: boolean) => void,
  ) {
    const draft = loadDraft();
    const known = draft && this.find(draft.preset);
    this.presetName = known ? draft.preset : BUILTIN_PRESETS[0].name;
    this.params = { ...(known ? draft.params : BUILTIN_PRESETS[0].params) };
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('change', (e) => this.onSelect(e));
    this.render();
  }

  get name(): string {
    return this.presetName;
  }

  private find(name: string): Preset | undefined {
    return BUILTIN_PRESETS.find((p) => p.name === name) ?? this.user.find((p) => p.name === name);
  }

  private get preset(): Preset {
    return this.find(this.presetName) ?? BUILTIN_PRESETS[0];
  }

  private get modified(): boolean {
    return !sameParams(this.params, this.preset.params);
  }

  // 换成某个预设的参数
  load(name: string): void {
    const p = this.find(name);
    if (!p) return;
    this.presetName = p.name;
    Object.assign(this.params, p.params);
    this.confirmDelete = false;
    this.changed(true);
  }

  // 勾"横放"时：还在用没改过的内置预设，就顺手换成对应的那一套
  followSideways(sideways: boolean): void {
    if (this.modified) return;
    const [normal, riichi] = BUILTIN_PRESETS;
    if (sideways && this.presetName === normal.name) this.load(riichi.name);
    else if (!sideways && this.presetName === riichi.name) this.load(normal.name);
  }

  private changed(structural: boolean): void {
    saveDraft({ preset: this.presetName, params: { ...this.params } });
    if (structural) this.render();
    else this.refreshState();
    this.onChange(structural);
  }

  render(): void {
    const opt = (p: Preset) => `<option value="${esc(p.name)}" ${p.name === this.presetName ? 'selected' : ''}>${esc(p.name)}</option>`;
    const options =
      `<optgroup label="内置">${BUILTIN_PRESETS.map(opt).join('')}</optgroup>` +
      (this.user.length ? `<optgroup label="我的预设">${this.user.map(opt).join('')}</optgroup>` : '');
    const builtin = !!this.preset.builtin;
    const rows = PARAM_KEYS.map((k) => {
      const s = PARAM_SPECS[k];
      const v = (this.params[k] * s.scale).toFixed(decimals(s.step));
      return `
        <div class="lab-param" title="${s.hint}">
          <span>${s.label}</span>
          <input type="range" data-param="${k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" />
          <input type="number" data-param="${k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" />
          <small>${s.unit}</small>
        </div>`;
    }).join('');
    this.el.innerHTML = `
      <section>
        <h2>预设 <small data-r="modified"></small></h2>
        <select class="lab-select" data-p="preset">${options}</select>
        <div class="lab-row lab-actions">
          <button class="lab-chip" data-p="save" ${builtin ? 'disabled title="内置预设不能改，请用另存为"' : ''}>保存</button>
          <button class="lab-chip" data-p="saveas">另存为</button>
          <button class="lab-chip${this.confirmDelete ? ' danger' : ''}" data-p="delete" ${builtin ? 'disabled' : ''}>${this.confirmDelete ? '确认删除？' : '删除'}</button>
          <button class="lab-chip" data-p="export">导出</button>
          <button class="lab-chip" data-p="import">导入</button>
        </div>
        ${this.ioHtml()}
        <p class="lab-msg" data-r="msg">${esc(this.msg)}</p>
      </section>
      <section>
        <h2>参数 <small>拖动或直接填数字，马上生效</small></h2>
        ${rows}
        <button class="lab-chip lab-reset" data-p="reset">恢复成预设的值</button>
      </section>`;
    this.refreshState();
  }

  private ioHtml(): string {
    if (this.io === 'saveas') {
      const base = this.preset.builtin ? '我的出牌' : this.presetName;
      return `
        <div class="lab-io">
          <input type="text" class="lab-name" data-p="name" maxlength="40" value="${esc(this.user.some((p) => p.name === base) ? `${base} 2` : base)}" />
          <div class="lab-row"><button class="lab-chip on" data-p="saveas-ok">保存</button><button class="lab-chip" data-p="close">取消</button></div>
        </div>`;
    }
    if (this.io === 'export') {
      return `
        <div class="lab-io">
          <textarea readonly rows="8" data-p="json">${esc(exportPreset({ name: this.presetName, params: this.params }))}</textarea>
          <div class="lab-row"><button class="lab-chip on" data-p="copy">复制</button><button class="lab-chip" data-p="close">收起</button></div>
        </div>`;
    }
    if (this.io === 'import') {
      return `
        <div class="lab-io">
          <textarea rows="6" data-p="json" placeholder="把导出的 JSON 粘贴到这里"></textarea>
          <div class="lab-row"><button class="lab-chip on" data-p="import-ok">导入</button><button class="lab-chip" data-p="close">取消</button></div>
        </div>`;
    }
    return '';
  }

  // 只更新"已修改"和提示，不重画滑块（正在拖的滑块不能被换掉）
  private refreshState(): void {
    const m = this.el.querySelector('[data-r=modified]');
    if (m) m.textContent = this.modified ? '已修改，还没保存' : '';
    const msg = this.el.querySelector('[data-r=msg]');
    if (msg) msg.textContent = this.msg;
  }

  private say(text: string): void {
    this.msg = text;
    this.refreshState();
  }

  private onInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const k = input.dataset.param as keyof DiscardParams | undefined;
    if (!k) return;
    const s = PARAM_SPECS[k];
    const shown = parseFloat(input.value);
    if (!Number.isFinite(shown)) return;
    const clamped = Math.min(s.max, Math.max(s.min, shown));
    this.params[k] = clamped / s.scale;
    // 滑块和数字框互相跟着
    for (const other of this.el.querySelectorAll<HTMLInputElement>(`[data-param=${k}]`)) {
      if (other !== input) other.value = clamped.toFixed(decimals(s.step));
    }
    this.msg = '';
    this.changed(false);
  }

  private onSelect(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.dataset.p === 'preset') {
      this.msg = '';
      this.load((el as HTMLSelectElement).value);
    }
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
    const act = el.dataset.p;
    const wasConfirm = this.confirmDelete;
    this.confirmDelete = false;
    if (act === 'save') {
      const p = this.user.find((x) => x.name === this.presetName);
      if (!p) return;
      p.params = { ...this.params };
      this.persist(`已保存到"${p.name}"`);
    } else if (act === 'saveas') {
      this.open('saveas');
    } else if (act === 'saveas-ok') {
      const name = (this.el.querySelector<HTMLInputElement>('[data-p=name]')?.value ?? '').trim().slice(0, 40);
      if (!name) return this.say('先起个名字');
      if (BUILTIN_PRESETS.some((b) => b.name === name)) return this.say('和内置预设重名了，换个名字');
      const old = this.user.find((x) => x.name === name);
      if (old) old.params = { ...this.params };
      else this.user.push({ name, params: { ...this.params } });
      this.presetName = name;
      this.io = 'none';
      this.persist(old ? `已覆盖"${name}"` : `已存为"${name}"`);
    } else if (act === 'delete') {
      if (!wasConfirm) {
        this.confirmDelete = true;
        this.render();
        return;
      }
      const name = this.presetName;
      this.user = this.user.filter((x) => x.name !== name);
      saveUserPresets(this.user);
      this.msg = `已删除"${name}"`;
      this.load(BUILTIN_PRESETS[0].name);
    } else if (act === 'export') {
      this.open('export');
    } else if (act === 'import') {
      this.open('import');
    } else if (act === 'import-ok') {
      this.importJson(this.el.querySelector<HTMLTextAreaElement>('[data-p=json]')?.value ?? '');
    } else if (act === 'copy') {
      this.copy();
    } else if (act === 'close') {
      this.io = 'none';
      this.render();
    } else if (act === 'reset') {
      this.msg = '';
      this.load(this.presetName);
    } else {
      this.render();
    }
  }

  private open(io: Io): void {
    this.io = this.io === io ? 'none' : io;
    this.msg = '';
    this.render();
    this.el.querySelector<HTMLInputElement>('[data-p=name]')?.select();
  }

  private persist(okMsg: string): void {
    this.msg = saveUserPresets(this.user) ? okMsg : '这个浏览器存不了（可能是隐私模式），请用导出保存';
    saveDraft({ preset: this.presetName, params: { ...this.params } });
    this.render();
  }

  private importJson(text: string): void {
    let list: Preset[];
    try {
      list = parsePresets(text);
    } catch (err) {
      return this.say(`导入失败：${(err as Error).message}`);
    }
    for (const p of list) {
      // 和内置预设重名的，名字后面加个标记，免得覆盖不了
      const name = BUILTIN_PRESETS.some((b) => b.name === p.name) ? `${p.name}（导入）` : p.name;
      const old = this.user.find((x) => x.name === name);
      if (old) old.params = p.params;
      else this.user.push({ name, params: p.params });
      p.name = name;
    }
    this.io = 'none';
    this.msg = `导入了 ${list.length} 个预设`;
    saveUserPresets(this.user);
    this.load(list[0].name);
  }

  private copy(): void {
    const area = this.el.querySelector<HTMLTextAreaElement>('[data-p=json]');
    if (!area) return;
    const done = () => this.say('已复制，可以直接发给我');
    const fallback = () => {
      area.select();
      try {
        if (document.execCommand('copy')) return done();
      } catch {
        // 下面提示手动复制
      }
      this.say('浏览器不让自动复制，已经全选，请按 Ctrl+C（手机长按）复制');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(area.value).then(done, fallback);
    else fallback();
  }
}
