// A design the editor authored: every region is modelled, and every formula is
// inside the primitive vocabulary. Importable as-is, so it doubles as the
// interop fixture.

export const front = {
  name: 'aaron.front',
  measurements: ['shoulderToShoulder', 'hpsToWaistBack'],
  draft: ({ part, points, paths, Path, Point, measurements }) => {
    // <dressform:region id="n:front.cb">
    points.cb = new Point(0, 0)
    // </dressform:region>

    // <dressform:region id="n:front.shoulder">
    points.shoulder = points.cb.shift(-90, measurements.shoulderToShoulder / 2)
    // </dressform:region>

    // <dressform:region id="n:front.waist">
    points.waist = points.cb.shift(180, measurements.hpsToWaistBack)
    // </dressform:region>

    // <dressform:region id="n:front.armhole">
    paths.armhole = new Path()
      .move(points.shoulder)
      .curve(points.shoulder, points.waist, points.cb)
      .close()
    // </dressform:region>

    return part
  },
}
