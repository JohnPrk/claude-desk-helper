# Skins

A skin = 7 state frames + a few accessories. All files are SVG (or PNG)
at **256 × 256** with a **transparent background**, except accessories
which are smaller (60 × 60 ≒).

## Required state frames (7)

Mapped 1:1 to `PetState` in `src/types.ts`.

| 파일 이름 | 의미 | 트리거 |
|---|---|---|
| `idle.svg` | 풀 컨디션, 활기참 | 5h 또는 주간 잔량의 최솟값 ≥ 80% |
| `cheerful.svg` | 약간 줄어듦, 여전히 양호 | 60–80% |
| `tired.svg` | 보통, 피곤한 기색 | 40–60% |
| `weary.svg` | 지친 모습 | 20–40% |
| `sleepy.svg` | 거의 잠들기 직전, 눈 반쯤 감김 | 0–20% |
| `sleep.svg` | 5h 한도 소진, 곯아떨어짐 | 5h 잔량 = 0% |
| `dead.svg` | 주간 한도 소진, 녹초/뒹굴 | 주간 잔량 = 0% |

## Required accessories (3)

| 파일 이름 | 쓰임 |
|---|---|
| `bamboo.svg` | bamboo / scratch idle action |
| `apple.svg` | eat-fruit idle action |
| `dumbbell.svg` | exercise idle action |

## Spec

- 캔버스: **256 × 256** (액세서리는 **60 × 60**)
- 형식: **SVG** 권장 (벡터, 작음, 깔끔). PNG도 OK
- 배경: **투명**
- 화풍: 7개 상태가 **같은 캐릭터의 같은 화풍**, 표정/자세만 차이 나게
- viewBox: `0 0 256 256` (또는 0 0 60 60)

## 새 스킨(예: 고양이) 추가

1. `src/skins/<id>/` 폴더에 위 파일들 추가
2. `src/skins.ts`의 `SKINS` 배열에 새 스킨 항목 추가:

```ts
{
  id: "<id>",
  name: "표시 이름",
  frames: {
    idle: url("<id>/idle.svg"),
    cheerful: url("<id>/cheerful.svg"),
    tired: url("<id>/tired.svg"),
    weary: url("<id>/weary.svg"),
    sleepy: url("<id>/sleepy.svg"),
    sleep: url("<id>/sleep.svg"),
    dead: url("<id>/dead.svg"),
  },
}
```

3. Settings → 캐릭터 드롭다운에서 선택
