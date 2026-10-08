/**
 * mustacheEditor — 그리드 셀의 mustache(HTML) 템플릿을 클릭으로 편집하는 플러그인.
 *
 * 대상: 결재양식 설정(approvalFormSetting) 등 'MUSTACHE' 컬럼을 가진 그리드.
 *  - 셀값 = 한 줄짜리 HTML+mustache 문자열.
 *  - 대상 셀 클릭 → 모달(좌 미리보기 iframe / 우 소스편집 CodeMirror).
 *  - 열 때 beautify(들여쓰기), 적용 시 minify(한 줄화) → gridObj.$V 로 셀에 되돌림(CRUD='U' 자동).
 *  - 영구 저장은 화면의 기존 [저장] 버튼이 담당(우리는 셀만 갱신 — RFC 직접 쓰기 없음).
 *  - 소스편집기 = CodeMirror 5(htmlmixed + mustache 오버레이 + 줄번호). webpack 번들에 포함(자급자족).
 */
import CodeMirror from 'codemirror';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/addon/mode/overlay';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/idea.css';

// htmlmixed 위에 mustache({{...}} / {{{...}}}) 오버레이를 얹은 모드 1회 정의
CodeMirror.defineMode('htmlmustache', function (cfg) {
    const mustacheOverlay = {
        token: function (stream) {
            if (stream.match('{{')) {
                stream.eat('{'); // {{{ triple
                while (!stream.eol()) {
                    if (stream.match('}}}') || stream.match('}}')) break;
                    stream.next();
                }
                return 'mustache';
            }
            while (!stream.eol()) {
                if (stream.match('{{', false)) break;
                stream.next();
            }
            return null;
        }
    };
    return CodeMirror.overlayMode(CodeMirror.getMode(cfg, 'htmlmixed'), mustacheOverlay);
});

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
        // 그리드 렌더 시 gridObj를 직접 받음(어댑터 renderGridSingle → setGridOption 훅).
        // afterRenderUIComponents + DOM 스캔보다 정확/견고 — 그리드마다 호출됨.
        h.setGridOption = (gridObj) => $plugin.bind.tryAttach(gridObj);
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
        // 그리드 하나가 렌더될 때마다 호출(setGridOption). 대상 컬럼 보유 + 미바인딩이면 클릭 이벤트 연결.
        tryAttach: (gridObj) => {
            try {
                if (!gridObj || gridObj.__mustacheEditorBound) return;
                const cols = $plugin.targetColumns();
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
            } catch (e) {
                /* noop */
            }
        },

        // 셀 클릭 이벤트 바인딩 (unidocu wrapper onCellClick → (columnKey, rowIndex))
        //   대상 컬럼 셀을 클릭하면 편집 모달 오픈. rowIndex 는 $V 에 그대로 사용 가능.
        attach: (gridObj, cols) => {
            try {
                gridObj.onCellClick((columnKey, rowIndex) => {
                    try {
                        if (cols.indexOf(columnKey) === -1) return; // 대상 컬럼(기본 MUSTACHE)만
                        if (rowIndex == null || isNaN(rowIndex) || rowIndex < 0) return;
                        $plugin.ui.openEditor(gridObj, columnKey, rowIndex);
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
        _restore: (text, store) =>
            text.replace(/\u0000M(\d+)\u0000/g, (m, i) => {
                const v = store[Number(i)];
                return typeof v === 'string' ? v : m; // style 엔트리(객체)는 beautify emit 단계에서 이미 펼쳐짐
            }),

        // 블록 보호(스크립트/pre는 통째 opaque). mustache는 토크나이저가 봐야 하므로 살려둠.
        //   <style>은 내부 CSS를 따로 저장({__style, open, css}) → beautify 단계에서 CSS 포맷팅.
        _protectBlocks: (html) => {
            const store = [];
            const stash = (s) => {
                store.push(s);
                return '\u0000M' + (store.length - 1) + '\u0000';
            };
            const out = String(html)
                .replace(/(<style[^>]*>)([\s\S]*?)<\/style>/gi, (m, open, css) => stash({__style: true, open: open, css: css}))
                .replace(/<script[\s\S]*?<\/script>/gi, (m) => stash(m))
                .replace(/<pre[\s\S]*?<\/pre>/gi, (m) => stash(m));
            return {text: out, store: store};
        },

        // 간이 CSS 포맷터 — { } ; 기준 줄바꿈/들여쓰기. 상대 레벨 라인 배열 반환('    ' 단위).
        //   @media 등 중첩 블록도 레벨 처리. 완벽 파서 아님(주석/문자열 내 { } ; 는 미처리).
        _formatCss: (css) => {
            const text = String(css).replace(/\s+/g, ' ').trim();
            const P = '    ';
            const lines = [];
            let lvl = 0;
            let buf = '';
            const push = (t) => {
                if (t) lines.push(P.repeat(lvl) + t);
            };
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '{') {
                    push(buf.trim() + ' {');
                    buf = '';
                    lvl++;
                } else if (ch === '}') {
                    const d = buf.trim();
                    buf = '';
                    if (d) push(d.replace(/;?$/, ';'));
                    lvl = Math.max(0, lvl - 1);
                    push('}');
                } else if (ch === ';') {
                    const d = buf.trim();
                    buf = '';
                    if (d) push(d + ';');
                } else {
                    buf += ch;
                }
            }
            if (buf.trim()) push(buf.trim());
            return lines;
        },

        // 한 줄 → 사람이 보기 좋은 들여쓰기 (토크나이저 기반)
        //   태그 / mustache / 텍스트를 토큰으로 쪼개 트리 들여쓰기. mustache 섹션({{#}}/{{/}})도 블록으로.
        //   리프(단일 내용)는 한 줄 유지(<th>{{{제목}}}</th>). 완벽 파서는 아니나 결재양식 수준은 깔끔.
        beautify: (html) => {
            if (!html) return '';
            const p = $plugin.format._protectBlocks(html);
            const s = p.text;
            const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
            const classify = (raw) => {
                if (/^<!--/.test(raw)) return {t: 'leaf', v: raw};
                if (raw.charAt(0) === '<') {
                    if (raw.charAt(1) === '/') return {t: 'close', name: (raw.match(/^<\/\s*([\w-]+)/) || [])[1] || '', v: raw};
                    const name = (raw.match(/^<\s*([\w-]+)/) || [])[1] || '';
                    if (/\/>\s*$/.test(raw) || VOID.test(name)) return {t: 'leaf', v: raw};
                    return {t: 'open', name: name, v: raw};
                }
                if (raw.charAt(0) === '{') {
                    if (/^\{\{[#^]/.test(raw)) return {t: 'open', name: (raw.match(/^\{\{[#^]\s*([\w.]+)/) || [])[1] || '', v: raw};
                    if (/^\{\{\//.test(raw)) return {t: 'close', name: (raw.match(/^\{\{\/\s*([\w.]+)/) || [])[1] || '', v: raw};
                    return {t: 'leaf', v: raw}; // {{x}} {{{x}}} {{!..}} {{>..}} {{&..}}
                }
                return {t: 'text', v: raw};
            };
            const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g;
            const toks = [];
            let last = 0;
            let m;
            while ((m = re.exec(s))) {
                if (m.index > last) toks.push(classify(s.slice(last, m.index)));
                toks.push(classify(m[0]));
                last = re.lastIndex;
            }
            if (last < s.length) toks.push(classify(s.slice(last)));

            const norm = (v) => v.replace(/\s+/g, ' ');
            const pad = '    ';
            // 토큰이 style 블록 플레이스홀더면 그 store 엔트리({__style,...}) 반환, 아니면 null
            const styleEntry = (v) => {
                const sm = norm(v)
                    .trim()
                    .match(/^\u0000M(\d+)\u0000$/);
                const e = sm && p.store[Number(sm[1])];
                return e && e.__style ? e : null;
            };
            let indent = 0;
            const out = [];
            for (let i = 0; i < toks.length; i++) {
                const tk = toks[i];
                if (tk.t === 'text') {
                    const se = styleEntry(tk.v);
                    if (se) {
                        // <style> + 포맷된 CSS(indent+1) + </style>
                        out.push(pad.repeat(indent) + se.open);
                        $plugin.format._formatCss(se.css).forEach((ln) => out.push(pad.repeat(indent + 1) + ln));
                        out.push(pad.repeat(indent) + '</style>');
                        continue;
                    }
                    const txt = norm(tk.v).trim();
                    if (txt) out.push(pad.repeat(indent) + txt);
                    continue;
                }
                if (tk.t === 'leaf') {
                    out.push(pad.repeat(indent) + tk.v);
                    continue;
                }
                if (tk.t === 'close') {
                    indent = Math.max(0, indent - 1);
                    out.push(pad.repeat(indent) + tk.v);
                    continue;
                }
                // open: 중첩 open 없이 매칭 close까지면 한 줄로(inline). 단 너무 길면(>INLINE_MAX) 블록으로 펼침
                //   → <td>{{x}}</td> 같은 짧은 건 한 줄 유지, <colgroup><col>...12개</colgroup> 같은 긴 건 펼침.
                const INLINE_MAX = 100;
                let j = i + 1;
                let ok = true;
                const parts = [];
                for (; j < toks.length; j++) {
                    const t = toks[j];
                    if (t.t === 'open') {
                        ok = false;
                        break;
                    }
                    if (t.t === 'close') break;
                    if (t.t === 'text' && styleEntry(t.v)) {
                        ok = false; // style 블록은 인라인 금지(별도 펼침)
                        break;
                    }
                    parts.push(t.t === 'text' ? norm(t.v) : t.v);
                }
                if (ok && j < toks.length && toks[j].t === 'close' && toks[j].name === tk.name) {
                    const inner = parts.join('').replace(/\s+/g, ' ').trim();
                    const oneLine = tk.v + inner + toks[j].v;
                    if (oneLine.length <= INLINE_MAX) {
                        out.push(pad.repeat(indent) + oneLine);
                        i = j;
                        continue;
                    }
                    // 길면 인라인 포기 → 아래 블록 경로로 (자식 토큰은 메인 루프가 각 줄 처리)
                }
                out.push(pad.repeat(indent) + tk.v);
                indent++;
            }
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
    // ui : 편집 모달 (좌 iframe 미리보기 / 우 CodeMirror 소스편집)
    // ────────────────────────────────────────────────────────────────────
    ui: {
        // CodeMirror/모달용 스타일 1회 주입 (에디터 테두리·폰트 + mustache 토큰 색). 높이는 동적(setSize).
        _injectStyle: () => {
            if (document.getElementById('me-cm-style')) return;
            const css =
                '.me-src .CodeMirror{border:1px solid #ccc;border-radius:4px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.5;height:auto;width:100%;box-sizing:border-box}' +
                '.me-panes{overflow:hidden}' +
                '.me-pane-preview,.me-pane-src{min-width:0;overflow:hidden}' +
                '.cm-mustache{color:#d6336c;font-weight:bold}' +
                '.me-view.active{background:#3b5bdb;color:#fff}';
            const st = document.createElement('style');
            st.id = 'me-cm-style';
            st.textContent = css;
            document.head.appendChild(st);
        },

        openEditor: (gridObj, field, row) => {
            const u = $plugin.util;
            $plugin.ui._injectStyle();
            let raw = '';
            try {
                raw = gridObj.$V(field, row);
            } catch (e) {
                raw = '';
            }
            raw = raw == null ? '' : String(raw);
            const pretty = $plugin.format.beautify(raw);

            const $c = $(
                '<div style="display:flex;flex-direction:column;height:100%;width:100%;min-width:0;box-sizing:border-box;overflow:hidden">' +
                    // 상단 툴바: 뷰 토글 + 안내
                    '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
                    '    <button class="unidocu-button me-view" data-v="both">나란히</button>' +
                    '    <button class="unidocu-button me-view" data-v="preview">미리보기</button>' +
                    '    <button class="unidocu-button me-view" data-v="source">소스</button>' +
                    '    <span style="flex:1;color:#888;font-size:12px;text-align:right">소스 수정 → 미리보기 갱신. <b>[적용]</b> 후 화면의 <b>[저장]</b> 버튼으로 영구 반영.</span>' +
                    '  </div>' +
                    // 패널 영역 (남은 높이 전부 차지)
                    '  <div class="me-panes" style="display:flex;gap:10px;flex:1;min-height:0">' +
                    '    <div class="me-pane-preview" style="flex:1;display:flex;flex-direction:column;min-width:0">' +
                    '      <div style="font-weight:bold;margin-bottom:4px">미리보기</div>' +
                    '      <iframe class="me-preview" style="width:100%;flex:1;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;background:#fff"></iframe>' +
                    '    </div>' +
                    '    <div class="me-pane-src" style="flex:1;display:flex;flex-direction:column;min-width:0">' +
                    '      <div style="font-weight:bold;margin-bottom:4px">소스 편집</div>' +
                    '      <div class="me-src" style="flex:1;min-width:0;min-height:0"></div>' +
                    '    </div>' +
                    '  </div>' +
                    '</div>'
            );
            const $preview = $c.find('.me-preview');

            // CodeMirror 소스 에디터 (htmlmixed + mustache 오버레이 + 줄번호)
            const cm = CodeMirror($c.find('.me-src')[0], {
                value: pretty,
                mode: 'htmlmustache',
                theme: 'idea',
                lineNumbers: true,
                lineWrapping: false,
                tabSize: 4,
                indentUnit: 4,
                smartIndent: true
            });

            const renderPreview = () => {
                try {
                    // srcdoc 로 격리 렌더 (셀값의 <style> 가 호스트 CSS 오염시키는 것 방지)
                    $preview.get(0).srcdoc = cm.getValue();
                } catch (e) {
                    /* noop */
                }
            };
            cm.on('change', u.debounce(renderPreview, 250));

            // 패널 높이를 모달 내용 높이에 맞춤 (iframe + CodeMirror)
            const sizePanes = () => {
                const ch = $c.height() || 0;
                const ph = Math.max(240, ch - 70); // 툴바 + 라벨 여유
                $preview.css('height', ph + 'px');
                try {
                    cm.setSize('100%', ph);
                    cm.refresh();
                } catch (e) {
                    /* noop */
                }
            };

            // 뷰 토글: 나란히 / 미리보기 / 소스
            const setView = (v) => {
                const $pv = $c.find('.me-pane-preview');
                const $sr = $c.find('.me-pane-src');
                if (v === 'preview') {
                    $pv.show().css('flex', '1');
                    $sr.hide();
                } else if (v === 'source') {
                    $sr.show().css('flex', '1');
                    $pv.hide();
                } else {
                    $pv.show().css('flex', '1');
                    $sr.show().css('flex', '1');
                }
                $c.find('.me-view').removeClass('active');
                $c.find('.me-view[data-v="' + v + '"]').addClass('active');
                setTimeout(sizePanes, 0);
            };
            $c.on('click', '.me-view', function () {
                setView($(this).attr('data-v'));
            });

            const close = () => {
                try {
                    $c.dialog('close');
                } catch (e) {
                    /* noop */
                }
            };

            // 모달을 팝업창의 대부분 차지하게 (작은 디버그 팝업에서도 넓게)
            const winW = window.innerWidth || 1200;
            const winH = window.innerHeight || 900;
            const dlgW = Math.max(900, winW - 80);
            const dlgH = Math.max(560, winH - 90);

            u.modal({
                title: 'mustache 편집' + (field ? ' — ' + field : ''),
                width: dlgW,
                height: dlgH,
                $content: $c,
                buttons: [
                    {text: '취소', cls: 'unidocu-button', onClick: close},
                    {
                        text: '적용',
                        cls: 'unidocu-button blue',
                        onClick: () => {
                            const min = $plugin.format.minify(cm.getValue());
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

            // 모달 리사이즈 시 패널/에디터 크기 재조정
            $c.on('dialogresize dialogresizestop', sizePanes);

            // DOM 올라간 뒤 초기 뷰(나란히) + 사이징 + 미리보기
            setTimeout(() => {
                setView('both');
                sizePanes();
                renderPreview();
            }, 0);
        }
    },

    // ────────────────────────────────────────────────────────────────────
    // util
    // ────────────────────────────────────────────────────────────────────
    util: {
        // 어댑터 공용 tools.debounce 우선 사용(없으면 로컬 폴백)
        debounce: (fn, ms) => {
            const t = $u.plugins && $u.plugins.tools;
            if (t && typeof t.debounce === 'function') return t.debounce(fn, ms);
            let timer = null;
            return function () {
                const args = arguments;
                const ctx = this;
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(ctx, args), ms);
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
            const dlgOpts = {
                title: opts.title || '',
                buttons: buttons,
                width: String(opts.width || 640),
                draggable: true,
                resizable: true
            };
            if (opts.height) dlgOpts.height = Number(opts.height);
            return $u.baseDialog.openModalDialog(opts.$content, dlgOpts);
        }
    }
};
