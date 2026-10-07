# mustacheEditor

그리드 셀에 한 줄로 박혀 있는 **mustache(HTML) 템플릿**을, 더블클릭 한 번으로 **소스 편집 + 실시간 미리보기** 모달에서 편하게 고치는 unidocu 플러그인.

## 배경 (AS-IS → TO-BE)

- **AS-IS**: 셀값을 복사 → IDE에 붙여넣기 → 코드정리로 줄바꿈 복원 → 수정 → 다시 복사 → 셀에 붙여넣기 (왕복이 번거로움)
- **TO-BE**: 대상 셀을 **더블클릭** → 모달(좌 **소스 편집** / 우 **미리보기**) → 바로 고치고 **적용** → 화면의 기존 `저장` 버튼으로 반영

## 동작

- 어댑터 `afterRenderUIComponents` 훅에서 화면의 그리드를 스캔 → **대상 컬럼(기본 `MUSTACHE`)** 이 있는 그리드에 더블클릭 바인딩 (programId/화면 무관, 컬럼 기준)
- 더블클릭 → 셀값을 **beautify**(들여쓰기)해서 textarea에 표시, 우측 `iframe` 에 원본 HTML 그대로 렌더(스타일 격리). 입력 시 디바운스로 미리보기 갱신
- **적용** → 편집값을 **minify**(한 줄화)해서 `gridObj.$V(컬럼, 행, 값)` 로 셀에 되돌림 → CRUD='U' 자동 → **기존 저장 버튼**이 영구 반영
- RFC 직접 쓰기 없음 (셀 갱신만) — 안전

## 설정 (config, 옵션)

```js
$u.plugins.setOptions('mustacheEditor', {
    targetColumns: ['MUSTACHE'] // 더블클릭 편집 대상 컬럼키 (기본 MUSTACHE)
});
```

## 구성 (src/main.js)

| 모듈 | 역할 |
|---|---|
| `bind` | 렌더 후 대상 컬럼 보유 그리드 탐지 + 더블클릭 바인딩(1회) |
| `format` | beautify(열 때) / minify(적용 시) — 라이브러리 없이 `{{}}`·`<style>` 보호 |
| `ui` | 편집 모달(좌 textarea / 우 iframe 미리보기) |

## 빌드

```bash
npm ci
npm run build   # webpack → dist/plugin.js (UMD)
```

## 배포

- Jenkins (`Jenkinsfile`) → NAS `<plugins>/mustacheEditor/<version>/plugin.js`

## 상태

초기 1차 구현. 포맷터는 결재양식 HTML 수준(div/table/style 위주) 커버하는 간이 구현 — 완벽 포맷터는 아님.
