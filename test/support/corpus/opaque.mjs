// One region per construct in the editor spec §5 opacity table, so each reason
// can be asserted against a real file rather than a synthetic node.
//
// The regions that *are* modelled sit among them, which is the point: a
// partially opaque document must still be editable everywhere else.

export const back = {
  name: 'bent.back',
  draft: ({ part, points, paths, Path, Point, measurements, store, macro, utils }) => {
    // <dressform:region id="n:back.cb">
    points.cb = new Point(0, 0)
    // </dressform:region>

    // <dressform:region id="n:back.loop">
    for (let i = 0; i < 3; i++) {
      points.cp = new Point(i, i)
    }
    // </dressform:region>

    // <dressform:region id="n:back.conditional">
    if (measurements.chest > 900) {
      points.bust = new Point(0, 10)
    } else {
      points.bust = new Point(0, 20)
    }
    // </dressform:region>

    // <dressform:region id="n:back.template">
    points.label = new Point(0, `neck-${measurements.neck}`)
    // </dressform:region>

    // <dressform:region id="n:back.computed">
    points.offset = new Point(0, points['cp' + '0'].x)
    // </dressform:region>

    // <dressform:region id="n:back.store">
    points.ease = new Point(0, store.get('ease', 0))
    // </dressform:region>

    // <dressform:region id="n:back.macro">
    points.opening = macro('neckOpening', { from: points.cb })
    // </dressform:region>

    // <dressform:region id="n:back.unknown">
    points.helper = utils.curveFrom(points.cb, 30)
    // </dressform:region>

    // <dressform:region id="n:back.waist">
    points.waist = points.cb.shift(180, measurements.hpsToWaistBack)
    // </dressform:region>

    // <dressform:region id="n:back.armhole">
    paths.armhole = new Path().move(points.cb).line(points.waist).close()
    // </dressform:region>

    return part
  },
}
