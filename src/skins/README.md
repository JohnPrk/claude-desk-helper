# Skins

A skin = 7 static state PNGs + 3 accessories, plus optional motion GIFs.

The default base format is **PNG** (transparent, square). When you want
explicit motion for an idle action (roll, jump, spin, …), drop a **GIF**
of the same character in the skin folder and wire it up in `skins.ts`.
Until a gif is provided for an action, the existing CSS keyframes in
`App.css` animate the static PNG as a fallback.

## Required state frames (7)

PNG, **256 × 256**, transparent background. Mapped 1:1 to `PetState` in
`src/types.ts`.

| 파일 이름 | 의미 | 트리거 |
|---|---|---|
| `idle.png` | 풀 컨디션, 활기참 | 5h 또는 주간 잔량의 최솟값 ≥ 80% |
| `cheerful.png` | 약간 줄어듦, 여전히 양호 | 60–80% |
| `tired.png` | 보통, 피곤한 기색 | 40–60% |
| `weary.png` | 지친 모습 | 20–40% |
| `sleepy.png` | 거의 잠들기 직전, 눈 반쯤 감김 | 0–20% |
| `sleep.png` | 5h 한도 소진, 곯아떨어짐 | 5h 잔량 = 0% |
| `dead.png` | 주간 한도 소진, 녹초/뒹굴 | 주간 잔량 = 0% |

## Required accessories (3)

PNG, **60 × 60**, transparent background.

| 파일 이름 | 쓰임 |
|---|---|
| `bamboo.png` | bamboo / scratch idle action |
| `apple.png` | eat-fruit idle action |
| `dumbbell.png` | exercise idle action |

## Optional motion GIFs (per action)

Each idle action can optionally have its own animated GIF. When present,
the renderer swaps the static state PNG for the GIF while the action
plays and swaps it back when the action ends. When absent, the static
PNG stays on screen and the CSS keyframes in `App.css` provide a
transform-based fallback motion.

GIF spec:

- 캔버스: **256 × 256**, 투명 배경
- 길이: 액션 지속시간(`IDLE_ACTIONS` in `App.tsx`)에 맞추거나 그 이하로 루프
- 액션 이름은 다음 중 하나: `roll`, `bamboo`, `jump`, `spin`, `run`,
  `shy`, `doze`, `scratch`, `wave`, `lying`, `front-roll`, `eat-fruit`,
  `exercise`

권장 파일명: `<action>.gif` (예: `roll.gif`, `jump.gif`).

## Spec 요약

- 상태 프레임: **256 × 256 PNG**, 투명
- 액세서리: **60 × 60 PNG**, 투명
- 동작 GIF: **256 × 256 GIF**, 투명, 루프
- 화풍: 모든 상태/동작이 **같은 캐릭터의 같은 화풍**, 표정/자세만 차이

## 새 스킨(예: 고양이) 추가

1. `src/skins/<id>/` 폴더에 위 PNG들을 추가 (필요하면 GIF도)
2. `src/skins.ts`의 `SKINS` 배열에 새 스킨 항목 추가:

```ts
import catIdle from "./skins/cat/idle.png";
// …나머지 상태 import…
import catRollGif from "./skins/cat/roll.gif"; // 선택

{
  id: "cat",
  name: "고양이",
  frames: {
    idle: catIdle,
    cheerful: catCheerful,
    tired: catTired,
    weary: catWeary,
    sleepy: catSleepy,
    sleep: catSleep,
    dead: catDead,
  },
  // 동작별 GIF는 있는 것만 채워 넣으면 됨. 비어 있는 동작은 CSS로 움직임.
  actions: {
    roll: catRollGif,
  },
}
```

3. Settings → 캐릭터 드롭다운에서 선택
