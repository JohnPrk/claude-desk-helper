# 토큰 판다 (Token Panda)

> 데스크톱 한구석에서 너의 Claude 토큰 잔량을 지켜봐주는 작은 판다.

[![Download .dmg](https://img.shields.io/badge/Download-.dmg%20v0.99-6b4cff?style=for-the-badge&logo=apple)](https://github.com/JohnPrk/token-panda/releases/latest/download/토큰.판다_0.99_aarch64.dmg)
[![macOS only](https://img.shields.io/badge/platform-macOS%2011%2B-lightgrey?style=for-the-badge&logo=apple)](#한계)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](#라이선스)

<br><br>

## 왜 만들었나

**Claude의 가장 큰 단점은 토큰이 부족하다는 것.** 5시간 한도 / 주간 한도가 정해져 있어서 답변 받다가 갑자기 멈추거나, 다음 답변을 미루고 한 시간을 기다려야 하는 경우가 자주 생깁니다.

이 한계를 그나마 깎을 수 있는 거의 유일한 수단이 **프롬프트 캐시**입니다. 마지막 요청에서 5분 안에 다음 요청을 보내면 그 직전까지의 컨텍스트가 캐시 히트로 처리돼 토큰이 거의 안 빠집니다. 문제는, 그 5분이 백그라운드에서 다른 일 하다 보면 너무 쉽게 흘러간다는 것.

**토큰 판다**는 이 두 가지를 동시에 알려줍니다.

- 메뉴바에 **5시간 잔량**을 라이브로 표시
- 데스크톱 한 구석에 앉아 **캐시가 만료되기 전에 살짝 흔들리며 신호**
- 매번 claude.ai/settings/usage 탭을 새로 여는 의식이 사라짐
- 백그라운드 작업 중에도 캐시를 놓치지 않도록 캐릭터가 알려줌
- **클릭 앤 드래그로 거슬리지 않는 곳에 옮길 수 있고**, 화면을 가리지도 않음

캐릭터는 5h/주간 잔량의 최솟값에 따라 8단계로 모습이 바뀝니다. 토큰이 다 떨어지면 누워버리고, 캐시가 만료될 때쯤 머리 위 말풍선이 카운트다운을 시작합니다.

캐릭터는 가만히 있지 않고 배터리가 충분할수록 자주 움직입니다. 데굴데굴 구르거나(roll), 가볍게 점프하거나(jump), 좌우로 달리거나(run), 머리 위에 대나무를 얹고 긁적이거나(scratch), 좌우로 기우뚱하거나(wobble), 위에서 눌렸다 튀어 오릅니다(squish). 캐시 hit이 들어오는 순간 노란 폭죽이 배경에서 터지고, 캐시 miss(=캐시 만료 후 재생성)가 발생하면 머리 위로 푸른 비가 떨어집니다.

<br><br>

## 다운로드 / 설치

<br>

### 가장 빠른 방법: 빌드된 .dmg

위쪽 **`Download .dmg`** 배지를 눌러 최신 `.dmg`를 받고, 열어서 `Applications` 폴더로 드래그하면 끝입니다.

> 처음 실행할 때 macOS가 "확인되지 않은 개발자" 경고를 띄울 수 있어요. `시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기`로 한 번 허용하면 다음부터는 바로 실행됩니다. (앱이 정식으로 Apple Developer ID 서명을 받기 전까지는 이 단계가 필요해요.)

<br>

### 직접 빌드해서 쓰기

```bash
git clone https://github.com/JohnPrk/token-panda.git
cd token-panda
npm install
npm run tauri:build
# → src-tauri/target/release/bundle/dmg/토큰 판다_<version>_aarch64.dmg
```

빌드 시 필요한 도구:

- macOS 11+
- Node 18+
- Rust toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`)

<br><br>

## 어떻게 사용하나

<br>

### 1. 처음 실행

별도의 **시작하기** 창이 뜹니다. 두 단계로 진행됩니다.

1. **캐릭터 고르기**: 데스크톱 모서리에 앉을 친구를 고릅니다. 나중에 `설정`에서 언제든 변경 가능.
2. **claude.ai 연동**: Org ID + 세션 쿠키를 한 번만 등록하면 끝. 자세한 절차는 창 안에 단계별로 적혀 있습니다.

(연동을 나중에 하고 싶으면 "건너뛰고 시작"을 눌러도 됩니다. 메뉴바 → `설정...`에서 다시 입력할 수 있어요.)

<br>

### 2. 메뉴바 / 펫 창

| 위치 | 보이는 것 | 조작 |
| --- | --- | --- |
| 메뉴바 | 5시간 잔량 % + 대나무 이모지 (🎋 / 🌾 / 🥱 / 🍂 / 🔌) | 좌클릭으로 메뉴 열기. 클릭해도 펫이 사라지지 않습니다. |
| 메뉴바 메뉴 | `펫 보이기/숨기기`, `지금 새로고침`, `설정...`, `종료` | 펫을 일시적으로 숨기고 싶을 때 |
| 펫 창 | 5h / 주간 잔량 % + 캐시 타이머 + 캐릭터 모션 | 클릭 앤 드래그로 위치 이동, 우클릭으로 즉시 새로고침 |

<br>

### 3. 잔량을 어떻게 가져오는가

**claude.ai의 `/api/.../usage`** 를 직접 조회해 정확한 사용량 %를 가져옵니다. Org ID + 세션 쿠키만 한 번 등록하면 30초 폴링으로 자동 갱신됩니다.

자세한 추출 방법은 시작하기 / 설정 창 안에 단계별로 안내됩니다. 핵심만 말하면:

- **Org ID**: [claude.ai/settings/account](https://claude.ai/settings/account) → "조직 ID"
- **세션 쿠키**: [claude.ai/settings/usage](https://claude.ai/settings/usage)에서 ⌘⌥I → Network 탭 → `usage` 요청 → Request Headers의 `cookie:` 줄 통째로 복사

쿠키 줄에서 실제로 사용하는 키는 5개뿐(`sessionKey`, `cf_clearance`, `__cf_bm`, `_cfuvid`, `routingHint`)이고 나머지는 무시됩니다.

<br><br>

## 동작 원리

<br>

### 데이터 소스

```
GET https://claude.ai/api/organizations/<org-id>/usage
  Cookie: sessionKey=...; cf_clearance=...; __cf_bm=...; _cfuvid=...; routingHint=...
  → Anthropic 공식 utilization% 그대로
  → 30초마다 폴링
```

이 엔드포인트는 claude.ai 웹 UI가 직접 호출하는 **내부 API**입니다. 공식 문서에는 명시되지 않았지만 결과는 페이지에서 보는 값과 동일합니다.

<br>

### org + 쿠키 만으로 모든 API 요청을 보낼 수 있나?

**아니요.** Anthropic 환경에는 사실상 3개의 분리된 API가 있고 각각 인증이 다릅니다.

| 시스템 | 인증 | 권한 |
|---|---|---|
| **claude.ai 내부 API** (토큰 판다가 쓰는 곳) | 세션 쿠키 (`sessionKey` 등) | 본인 claude.ai 구독의 사용량 % 조회 |
| Anthropic API (`api.anthropic.com`) | `x-api-key: sk-ant-api-...` | 모델 호출 (`/v1/messages` 등), 토큰 단위 과금 |
| Admin API | `x-api-key: sk-ant-admin-...` | 조직 사용량/비용/멤버 관리 |

org + 쿠키로는 **claude.ai 구독의 quota 조회만 됩니다.** 모델 호출이나 결제 정보 같은 건 API 키가 따로 필요하므로 토큰 판다가 가져갈 수도, 가져갈 필요도 없습니다.

> 그래도 쿠키 자체는 본인 claude.ai 세션 권한이 있어서 노출되면 다른 사람이 본인 계정의 사용량을 조회·소모할 수 있습니다. **너무 위험하진 않지만, 외부에 흘리지 않게 조심하세요.**

<br>

### 펫 상태 → 캐릭터

| 구분 | **full** | **high** | **good** | **mid** | **low** | **tired** | **sleepy** | **dead** | **disconnected** <sup>⚠️</sup> |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **캐릭터** | <img src="src/skins/panda/full.png" width="72" alt="full"/> | <img src="src/skins/panda/high.png" width="72" alt="high"/> | <img src="src/skins/panda/good.png" width="72" alt="good"/> | <img src="src/skins/panda/mid.png" width="72" alt="mid"/> | <img src="src/skins/panda/low.png" width="72" alt="low"/> | <img src="src/skins/panda/tired.png" width="72" alt="tired"/> | <img src="src/skins/panda/sleepy.png" width="72" alt="sleepy"/> | <img src="src/skins/panda/dead.png" width="72" alt="dead"/> | <img src="src/skins/panda/apple.png" width="72" alt="disconnected"/> |
| **5h 잔량** | 90~100% | 77~90% | 63~77% | 49~63% | 33~49% | 15~33% | 0~15% | 주간 0% | API 끊김 |

<br>

### 캐시 (프롬프트 캐시)

- **프롬프트 캐시 TTL: 5분.**
  마지막 요청 시각 + 5분이 지나면 다음 요청은 캐시 재생성으로 시작합니다 (= 토큰을 더 씀).
- 펫 머리 위 말풍선이 남은 시간을 **카운트다운**합니다.
- 1분 이하로 떨어지면 펫이 살짝 흔들리며 "`.` 이라도 눌러!" 라고 알려줍니다. 점 하나만 보내도 캐시가 살아납니다.
- **백그라운드 작업 중에도 데스크톱에 펫이 떠 있어서**, 다른 창을 보고 있다가도 시야 끝에서 흔들림으로 알아챌 수 있습니다.
- **캐시 hit/miss 시각 효과**: 매 응답마다 cache_read 토큰이 잡히면 캐릭터 뒤 배경에 **노란 폭죽**이 짧게 터지고, cache_read가 0이면(= 캐시 재생성) 머리 위에서 화면 아래까지 **푸른 비**가 잠깐 떨어집니다. 폴링 주기(30초) 안에 여러 응답이 동시에 잡히면 hit이 우선 표시됩니다.

<br>

### 쿠키 (세션·Cloudflare)

캐시(5분 TTL)와는 별개의 개념입니다. 쿠키는 claude.ai로 요청을 보낼 때 본인임을 증명하는 토큰이에요.

- **세션 쿠키** (`sessionKey`, `routingHint`): 보통 약 30일 정도 유지.
- **Cloudflare 쿠키** (`__cf_bm`, `cf_clearance`, `_cfuvid`): 짧으면 30분 ~ 길면 수 시간. claude.ai 탭을 자주 열어두면 자동으로 갱신됩니다.

쿠키가 만료되면 폴링이 HTTP 401·403·404를 받습니다. 토큰 판다가 이걸 자동으로 감지하고:

1. 캐릭터를 **`disconnected` 상태로 즉시 전환**해서 시각적으로 알리고,
2. **설정 창을 자동으로 다시 열어** 새 쿠키를 요청합니다.

claude.ai에 다시 들어가 쿠키 줄을 복사해 붙여넣고 `저장`만 누르면 메뉴바 잔량이 곧바로 다시 흐르기 시작합니다.

<br><br>

## 한계

- **macOS 11+ 만 지원합니다.** Windows / Linux 빌드는 현재 없습니다. (Tauri 자체는 다 지원하지만, 메뉴바·드래그·항상 위 패널 동작이 macOS 전제로 짜여 있습니다.)
- **claude.ai의 비공식 내부 엔드포인트**(`/api/organizations/<org>/usage`)에 의존합니다. Anthropic이 스키마를 바꾸면 깨질 수 있어요. 발견 즉시 패치 예정.
- **현재 캐릭터 모션은 정적 PNG + CSS 애니메이션**입니다. 1.0 마일스톤 이후 GIF 기반 랜덤 모션을 추가할 예정.
- **메뉴바 트레이 아이콘 사이즈**는 macOS 표준에 맞춰 `22×22` (1×) / `44×44` (2×) 템플릿 이미지로 동작합니다. 마스터 아이콘은 `src-tauri/icons/icon.png` (1024×1024) 한 장에서 자동 생성됩니다.

<br><br>

## 보안 / 프라이버시

- ✅ **로컬에서만 동작합니다.** Org ID와 쿠키는 이 컴퓨터 안 (`~/Library/Application Support/com.tnew.clauddeskpet/`)에만 저장되고, 앱이 직접 `claude.ai`로만 요청을 보냅니다. **외부 서버·분석 도구·텔레메트리 어디에도 전송하지 않습니다.** "연동 해제"를 누르면 즉시 삭제.
- ⚠️ **Org ID와 세션 쿠키는 사실상 본인의 Claude 계정 자격증명**입니다. 가져간 사람이 본인 계정으로 사용량을 조회·소모할 수 있어요. 너무 위험한 권한은 아니지만 (모델 호출이나 결제 정보 접근은 안 됨) **공유하지 마세요.** 화면 녹화·캡쳐·디스코드/슬랙에 붙여넣기 등으로 노출되지 않도록 조심하세요.
- 쿠키가 의심스러우면 [claude.ai/settings/account](https://claude.ai/settings/account) → "활성 세션"에서 해당 세션을 로그아웃하면 즉시 무효화됩니다.
- ⚠️ 현재 dmg는 **미서명**입니다. 처음 실행 시 macOS Gatekeeper가 경고를 띄울 수 있어요. `시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기`로 한 번 허용하면 다음부터 바로 실행됩니다. 향후 Apple Developer ID 서명·공증을 통해 이 경고를 제거할 예정.
- 🔔 **알림 권한**: 처음 실행 시 macOS가 알림 권한을 묻습니다. 허용해야 5h 잔량 30·10·0% 임계 알림이 뜹니다. 거부했어도 메뉴바 % 만으로 잔량 추적은 가능하고, 나중에 `시스템 설정 → 알림 → 토큰 판다`에서 다시 켤 수 있습니다.

<br><br>

## 버전

> 산식: 대기능 1개 = +0.1. 그 안에서 처리된 소기능들은 함께 묶여 같은 0.x에 들어감. 1.0 = 출시 마일스톤.

| 버전 | 날짜 | 주요 변경 |
| --- | --- | --- |
| 0.99 | 2026-05-02 | 1.0 직전 폴리시. flash-hit 노란 glow + 캐릭터 뒤 폭죽, flash-miss 비 viewport 바닥까지, 대나무 그림자 회색 음영 위치 보정, squish 1.2배, README 갱신 (idle 액션·hit/miss 안내·알림 권한) |
| 0.90 | 2026-05-02 | 액션 배경 요소: jump 발 아래 동적 그림자 + squish 바닥 임팩트 링 |
| 0.89 | 2026-05-02 | jump "!" 이모지 제거 + run 0.7s + 💨 → CSS 3D 바람 streaks (parallax 3줄) |
| 0.88 | 2026-05-02 | 신규 idle 액션: wobble (skewX 좌우 기우뚱) + squish (눌렸다 튀어 오름) |
| 0.87 | 2026-05-02 | idle 액션 4개로 축소(roll/jump/run/scratch) + 미사용 keyframe·액세서리·이모지 CSS 정리 |
| 0.86 | 2026-05-02 | 트레이 4단계 라이브 스왑 fix (`icon_as_template(false)` + swap마다 재선언) |
| 0.85 | 2026-05-02 | [소]×5 누적. 5h 단독 캐릭터 매핑, h3 호흡, 0.8.x 버전 통일, 펫 상태 표 카드 스타일, em dash 11곳 정리 |
| 0.8.0 | 2026-05-01 | Settings 별도 윈도우 + 디자인 폴리시. 입력 막힘을 별도 popup 윈도우로 분리해 원천 해소. 캐릭터 picker, 💬 도움말 팝업, 인증 실패 자동 재팝업, 앱 아이콘 판다 얼굴 + 회색 배경, 별도 onboarding 창, disconnected 상태 |
| 0.7.0 | ~ | claude.ai live usage API 연동. 30초 폴링, 쿠키 sanitize, anthropic-client 헤더로 Cloudflare 통과 |
| 0.6.0 | ~ | macOS 윈도우 핀닝, NSPanel + CGAssistiveTechHighWindowLevel + SkyLight private Space, 모든 Space에서 보이기, Dock 아이콘 숨김 |
| 0.5.0 | ~ | 트레이 + 임계치 알림 (30·10·0%) |
| 0.4.0 | ~ | 캐시 분석, thinking 감지 + hit/miss 콤보 + 플래시 이펙트 |
| 0.3.0 | ~ | 토큰 사용량 디스플레이, 배터리 스타일 5h + 주간, 캘리브레이션, 리셋 카운트다운 |
| 0.2.0 | ~ | 판다 캐릭터 시스템, 5단계 에너지 + idle 액션 + flash 이펙트 |
| 0.1.0 | ~ | 프로젝트 기반 셋업, Tauri 2 + React 19 + TS + Vite |

<br><br>

## 라이선스

MIT. 자유롭게 포크/수정/재배포하세요. 자세한 내용은 [`LICENSE`](LICENSE) 참고.

<br><br>

## 컨택트

버그를 발견했거나 기능 추가가 필요하면 편하게 연락주세요.

- 📧 [johnprk1993@gmail.com](mailto:johnprk1993@gmail.com)
- 🐛 [Issues](https://github.com/JohnPrk/token-panda/issues)
- 💬 [Discussions](https://github.com/JohnPrk/token-panda/discussions) — 사용 후기·아이디어·Q&A
