# Claude Desk Helper

> 데스크톱 한구석에서 너의 토큰을 지켜봐주는 작은 친구.

A tiny macOS desktop pet that watches your **Claude Code** usage in real time — so you don't have to keep checking `/cost` or guessing whether your 5-hour window has reset.

It quietly sits on your desktop and shows:

- **5-hour token gauge** — how much of your rolling 5-hour window you've burned
- **Weekly token gauge** — same for the 7-day window
- **5-minute prompt-cache timer** — a speech bubble above the pet's head counting down your cache TTL, with a "`.` 이라도 눌러!" nudge when only ~1 minute remains
- **Mood** that reacts to all of the above:
  - 100% energy → bouncing
  - getting tired (≥70%) → slower bob, washed out
  - 5h budget gone → 💤 sleeping
  - weekly budget gone → 💀 collapsed

> Inspired by [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk). This is a Claude-only **Tauri** rewrite (different stack, different scope) focused on **token quota & cache window awareness** rather than agent activity hooks.

---

## 어떻게 동작하나

`~/.claude/projects/**/*.jsonl` (Claude Code가 로컬에 남기는 세션 로그)을 파일 변경 이벤트로 추적합니다. 각 assistant 메시지의 `usage` 필드(`input_tokens` + `output_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`)를 합산해서:

- **5h** = 지금 시각으로부터 직전 5시간 안에 누적된 토큰
- **주간** = 직전 7일 안에 누적된 토큰
- **캐시 타이머** = 가장 최근 메시지 timestamp + 5분

> **주의:** Anthropic은 Pro/Max 구독의 정확한 한도를 공개하지 않습니다. 프리셋 값은 추정치이며 ([`src/types.ts`](src/types.ts)의 `PLAN_PRESETS`에서 직접 조정 가능), Custom 플랜으로 본인이 측정한 한도를 직접 입력할 수도 있습니다. 5h 윈도우는 슬라이딩 방식이라 Anthropic의 "첫 호출 시점부터 5시간" 윈도우와 미세하게 다를 수 있습니다.

---

## 설치 / 실행

### 빌드해서 쓰기

```bash
git clone https://github.com/<your-id>/claude-desk-helper.git
cd claude-desk-helper
npm install
npm run tauri:build      # → src-tauri/target/release/bundle/dmg/*.dmg
```

`.dmg`를 열고 Applications에 드래그하면 끝.

### 개발 모드 (소스 수정하면서)

```bash
npm install
npm run tauri:dev
```

### 사전 요구 사항

- macOS 11+
- Node 18+
- Rust toolchain (`rustup`) — 빌드하는 사람만 필요. 다 빌드된 `.dmg`를 받는 사람은 Rust 필요 없음.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
```

---

## 처음 실행하면

1. 플랜을 고르라는 모달이 뜹니다 — Pro / Max 5× / Max 20× / Custom
2. 선택하면 데스크톱 위에 작은 펫 창이 뜸 (280×320, 항상 위, 무테두리, 투명)
3. 어디든 드래그해서 옮길 수 있음
4. 마우스를 펫 위에 올리면 우측 상단에 ⚙ (설정) / × (닫기) 버튼이 나타남

설정 모달에서 언제든 플랜 한도와 캐릭터를 바꿀 수 있습니다.

---

## 캐릭터 / 스킨

기본은 `<svg>` 임시 판다입니다. 실제 PNG를 붙이려면:

1. 256×256, 투명 배경 PNG 4장 준비
   - `idle.png` — 기운찬 상태
   - `tired.png` — 시름시름 (70%+)
   - `sleep.png` — 잠자기 (5h 한도 소진)
   - `dead.png` — 녹초/뒹굴 (주간 한도 소진)
2. `src/skins/panda/` 폴더에 위 4개 파일을 넣고 `npm run tauri:dev`로 다시 띄우면 즉시 적용

새 캐릭터 추가 → [`src/skins/README.md`](src/skins/README.md) 참고.

---

## 폴더 구조

```
claude-desk-helper/
├── src/                       # React 프론트
│   ├── App.tsx                # 온보딩 + 펫 메인 + 설정
│   ├── petLogic.ts            # 토큰%·상태·캐시 타이머 계산
│   ├── types.ts               # 플랜 프리셋
│   ├── store.ts               # 설정 영속화 (tauri-plugin-store)
│   ├── skins.ts               # 스킨 레지스트리
│   └── skins/<id>/*.png       # 캐릭터 프레임
└── src-tauri/                 # Rust 백엔드
    ├── tauri.conf.json        # 투명/항상 위 창 설정
    └── src/
        ├── lib.rs             # invoke 핸들러 + watcher 부트
        └── usage.rs           # ~/.claude/projects/**/*.jsonl 파서
```

---

## 프라이버시

- 로컬에서만 동작합니다. 외부로 어떤 데이터도 전송하지 않습니다.
- 읽는 파일: `~/.claude/projects/**/*.jsonl` (Claude Code가 만든 본인 로그)
- 저장하는 것: 플랜 설정 1개 (Tauri의 plugin-store 기본 위치)

---

## 라이선스

MIT — 자유롭게 포크/수정/재배포하세요. PR / 이슈 환영합니다.
