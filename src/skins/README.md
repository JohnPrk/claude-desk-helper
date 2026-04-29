# Skins

각 스킨은 4개의 프레임 파일이 필요합니다. **SVG 또는 PNG** (정사각형, 권장 256×256, 투명 배경):

- `idle` — 기운찬 상태 (토큰 여유)
- `tired` — 시름시름 (70%+)
- `sleep` — 잠자기 (5h 한도 소진)
- `dead` — 녹초/뒹굴 (주간 한도 소진)

## 새 스킨 추가

1. `src/skins/<id>/` 폴더에 위 4개 파일 추가 (예: `idle.svg`)
2. `src/skins.ts`의 `SKINS` 배열에 항목 추가:

```ts
{
  id: "<id>",
  name: "표시 이름",
  frames: {
    idle: url("<id>/idle.svg"),
    tired: url("<id>/tired.svg"),
    sleep: url("<id>/sleep.svg"),
    dead: url("<id>/dead.svg"),
  },
},
```

기본 판다는 SVG 벡터로 들어가 있습니다 (`panda/*.svg`).
