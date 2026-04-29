# Skins

각 스킨은 4개의 PNG 프레임이 필요합니다 (정사각형, 권장 256×256, 투명 배경):

- `idle.png` — 기운찬 상태 (토큰 여유)
- `tired.png` — 시름시름 (70%+)
- `sleep.png` — 잠자기 (5h 한도 소진)
- `dead.png` — 녹초/뒹굴 (주간 한도 소진)

## 새 스킨 추가

1. `src/skins/<id>/` 폴더에 위 4개 PNG 추가
2. `src/skins.ts`의 `SKINS` 배열에 항목 추가:

```ts
{
  id: "<id>",
  name: "표시 이름",
  frames: {
    idle: url("<id>/idle.png"),
    tired: url("<id>/tired.png"),
    sleep: url("<id>/sleep.png"),
    dead: url("<id>/dead.png"),
  },
},
```

PNG가 없으면 `<svg>` 플레이스홀더 판다가 보입니다.
