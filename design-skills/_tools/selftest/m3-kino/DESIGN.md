---
motion:
  mode: кино
  stack: css
  tokens:
    micro: 150ms
    enter: 450ms
    scene: 1000ms
  easing:
    out: cubic-bezier(0.22, 1, 0.36, 1)
    inout: cubic-bezier(0.65, 0, 0.35, 1)
  stagger: 60ms
  distance: 24px
  properties: [transform, opacity, filter]
  reduced_motion: конечный кадр мгновенно
  signature:
    where: .hero
    what: заголовок доигрывает хореографию длиной в токен scene
    proof: m3-kino-motion-1440-hero кадры 1-12
---

# m3-kino

Фикстура для пробы «движение»: одна длительность 1000мс, равная объявленному токену `scene`
в режиме `кино`. Проба обязана не считать её «долгой» (порог > 700мс) при прогоне с `--design=`.
