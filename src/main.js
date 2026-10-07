/**
 * mustacheEditor — 그리드 셀의 mustache(HTML) 템플릿을 더블클릭으로 편집하는 플러그인.
 *
 * 대상: 결재양식 설정(approvalFormSetting) 등 'MUSTACHE' 컬럼을 가진 그리드.
 *  - 셀값 = 한 줄짜리 HTML+mustache 문자열.
 *  - 더블클릭 → 모달(좌 소스편집 textarea / 우 미리보기 iframe).
 *  - 열 때 beautify(들여쓰기), 적용 시 minify(한 줄화) → gridObj.$V 로 셀에 되돌림(CRUD='U' 자동).
 *  - 영구 저장은 화면의 기존 [저장] 버튼이 담당(우리는 셀만 갱신 — RFC 직접 쓰기 없음).
 */
const config = {
    name: 'mustacheEditor',
    targetColumns: ['MUSTACHE'] // 더블클릭 편집 대상 컬럼키 (config.targetColumns 로 오버라이드 가능)
};

let $plugin;

$u.plugins.addPlugin(config.name, {
    config: config,
    init: (pluginHandlers) => {
        $plugin.hooks(pluginHandlers);
    }
});

$plugin = {
    // 어댑터 훅 등록
    hooks: (h) => {
        // 화면 렌더 후 대상 그리드 탐지 + 더블클릭 바인딩
        h.afterRenderUIComponents = () => $plugin.bind.scan();
    },

    // 실제 적용할 대상 컬럼 목록 (config 오버라이드 우선)
    targetColumns: () => {
        const opt = ($u.plugins.getOptions(config.name) || {}).targetColumns;
        return Array.isArray(opt) && opt.length ? opt : config.targetColumns;
    },

    // ────────────────────────────────────────────────────────────────────
    // bind : 대상 컬럼 보유 그리드 탐지 + 셀 더블클릭 바인딩(그리드당 1회)
    // ────────────────────────────────────────────────────────────────────
    bind: {
        scan: () => {
            const cols = $plugin.targetColumns();
            $('.unidocu-grid')
                .toArray()
                .forEach((el) => {
                    if (!el.id) return;
                    let gridObj = null;
                    try {
                        gridObj = $u.gridWrapper.getGrid(el.id);
                    } catch (e) {
                        gridObj = null;
                    }
                    if (!gridObj || gridObj.__mustacheEditorBound) return;
                    let headers = [];
                    try {
                        headers = gridObj.getGridHeaders() || [];
                    } catch (e) {
                        headers = [];
                    }
                    const has = cols.some((c) => headers.some((h) => h.key === c));
                    if (!has) return;
                    gridObj.__mustacheEditorBound = true;
                    $plugin.bind.attach(gridObj, cols);
                });
        },

        // RealGrid 네이티브 더블클릭 이벤트에 바인딩 (unidocu wrapper _rg.onCellDblClicked)
        attach: (gridObj, cols) => {
            try {
                gridObj._rg.onCellDblClicked((grid, data) => {
                    try {
                        if (!data) return;
                        const field = data.column || data.fieldName;
                        if (!field || cols.indexOf(field) === -1) return;
                        let row = data.dataRow;
                        if ((row == null || isNaN(row)) && data.itemIndex != null) {
                            try {
                                row = grid.getDataRow(data.itemIndex);
                            } catch (e) {
                                row = data.itemIndex;
                            }
                        }
                        if (row == null || isNaN(row) || row < 0) return;
                        $plugin.ui.openEditor(gridObj, field, row);
                    } catch (e) {
                        /* noop */
                    }
                });
            } catch (e) {
                /* noop */
            }
        }
    },

    // ────────────────────────────────────────────────────────────────────
    // format : 라이브러리 없이 beautify(열 때) / minify(적용 시)
    //   {{...}} mustache 와 <style>/<script>/<pre> 블록은 원자단위로 보호(토큰 치환) 후 복원.
    //   완벽한 포맷터는 아님 — 결재양식 HTML 수준(div/table/style)을 커버하는 간이 구현.
    // ────────────────────────────────────────────────────────────────────
    format: {
        _protect: (html) => {
            const store = [];
            const stash = (s) => {
                store.push(s);
                return '\u0000M' + (store.length - 1) + '\u0000';
            };
            let out = String(html)
                .replace(/<style[\s\S]*?<\/style>/gi, stash)
                .replace(/<script[\s\S]*?<\/script>/gi, stash)
                .replace(/<pre[\s\S]*?<\/pre>/gi, stash);
            // mustache: {{{...}}} 먼저, 그다음 {{...}}
            out = out.replace(/\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g, stash);
            return {text: out, store: store};
        },
        _restore: (text, store) => text.replace(/\u0000M(\d+)\u0000/g, (m, i) => store[Number(i)]),

        // 한 줄 → 사람이 보기 좋은 들여쓰기
        beautify: (html) => {
            if (!html) return '';
            const p = $plugin.format._protect(html);
            let s = p.text;
            s = s.replace(/>\s+</g, '><'); // 태그 사이 공백 제거
            s = s.replace(/></g, '>\n<'); // 태그 경계마다 줄바꿈
            const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
            const lines = s.split('\n');
            let indent = 0;
            const pad = '    ';
            const out = [];
            lines.forEach((raw) => {
                const line = raw.trim();
                if (!line) return;
                const isClose = /^<\//.test(line);
                const isOpen = /^<[a-zA-Z]/.test(line) && !isClose;
                const tag = (line.match(/^<\/?\s*([a-zA-Z0-9-]+)/) || [])[1] || '';
                const selfClose = /\/>\s*$/.test(line) || VOID.test(tag);
                // 같은 줄에서 열고 닫힘 (<td>x</td>)
                const openAndClose = isOpen && new RegExp('</\\s*' + tag + '\\s*>\\s*$', 'i').test(line);
                if (isClose) indent = Math.max(0, indent - 1);
                out.push(pad.repeat(indent) + line);
                if (isOpen && !selfClose && !openAndClose) indent++;
            });
            return $plugin.format._restore(out.join('\n'), p.store);
        },

        // 편집본 → 한 줄 (셀 저장용). 단어 간격은 보존, 태그 사이 공백만 제거.
        minify: (html) => {
            if (!html) return '';
            const p = $plugin.format._protect(html);
            let s = p.text;
            s = s.replace(/\s+/g, ' '); // 공백런 → 한 칸 (단어 간격 보존)
            s = s.replace(/>\s+</g, '><'); // 태그 사이 공백 제거
            s = s.trim();
            return $plugin.format._restore(s, p.store);
        }
    },

    // ────────────────────────────────────────────────────────────────────
    // ui : 편집 모달 (좌 textarea / 우 iframe 미리보기)
    // ────────────────────────────────────────────────────────────────────
    ui: {
        openEditor: (gridObj, field, row) => {
            const u = $plugin.util;
            let raw = '';
            try {
                raw = gridObj.$V(field, row);
            } catch (e) {
                raw = '';
            }
            raw = raw == null ? '' : String(raw);
            const pretty = $plugin.format.beautify(raw);

            const $c = $(
                '<div style="min-width:900px">' +
                    '  <div style="color:#888;font-size:12px;margin-bottom:6px">좌측을 수정하면 우측 미리보기가 갱신됩니다. <b>[적용]</b> 후 화면의 <b>[저장]</b> 버튼을 눌러야 영구 반영됩니다.</div>' +
                    '  <div style="display:flex;gap:10px">' +
                    '    <div style="flex:1;display:flex;flex-direction:column">' +
                    '      <div style="font-weight:bold;margin-bottom:4px">소스 편집</div>' +
                    '      <textarea class="me-src" spellcheck="false" wrap="off" style="width:100%;height:460px;box-sizing:border-box;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre;overflow:auto;border:1px solid #ccc;border-radius:4px;padding:8px"></textarea>' +
                    '    </div>' +
                    '    <div style="flex:1;display:flex;flex-direction:column">' +
                    '      <div style="font-weight:bold;margin-bottom:4px">미리보기</div>' +
                    '      <iframe class="me-preview" style="width:100%;height:460px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;background:#fff"></iframe>' +
                    '    </div>' +
                    '  </div>' +
                    '</div>'
            );
            const $src = $c.find('.me-src');
            const $preview = $c.find('.me-preview');
            $src.val(pretty);

            const renderPreview = () => {
                try {
                    // srcdoc 로 격리 렌더 (셀값의 <style> 가 호스트 CSS 오염시키는 것 방지)
                    $preview.get(0).srcdoc = $src.val();
                } catch (e) {
                    /* noop */
                }
            };
            $src.on('input', u.debounce(renderPreview, 250));
            setTimeout(renderPreview, 0); // 최초 1회

            const close = () => {
                try {
                    $c.dialog('close');
                } catch (e) {
                    /* noop */
                }
            };

            u.modal({
                title: 'mustache 편집' + (field ? ' — ' + field : ''),
                width: 980,
                $content: $c,
                buttons: [
                    {text: '취소', cls: 'unidocu-button', onClick: close},
                    {
                        text: '적용',
                        cls: 'unidocu-button blue',
                        onClick: () => {
                            const min = $plugin.format.minify($src.val());
                            try {
                                gridObj.$V(field, row, min);
                            } catch (e) {
                                unidocuAlert('셀 적용 실패: ' + (e && e.message));
                                return;
                            }
                            close();
                            unidocuAlert('적용되었습니다.\n변경을 영구 저장하려면 화면의 [저장] 버튼을 누르세요.');
                        }
                    }
                ]
            });
        }
    },

    // ────────────────────────────────────────────────────────────────────
    // util
    // ────────────────────────────────────────────────────────────────────
    util: {
        debounce: (fn, ms) => {
            let t = null;
            return function () {
                const args = arguments;
                const ctx = this;
                clearTimeout(t);
                t = setTimeout(() => fn.apply(ctx, args), ms);
            };
        },
        // 공용 모달 (checkpoint/webdataVcs 와 동일한 $u.baseDialog 패턴)
        modal: (opts) => {
            const buttons = (opts.buttons || []).map((b) =>
                $u.baseDialog.getButton(
                    b.text,
                    () => {
                        if (b.onClick) b.onClick();
                    },
                    b.cls || 'unidocu-button'
                )
            );
            return $u.baseDialog.openModalDialog(opts.$content, {
                title: opts.title || '',
                buttons: buttons,
                width: String(opts.width || 640),
                draggable: true,
                resizable: true
            });
        }
    }
};
