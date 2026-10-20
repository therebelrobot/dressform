// A design the editor did NOT author: no fences anywhere. This is what v2
// read-back exists to make editable, and in v1 it is a refusal — the editor has
// nothing it may rewrite, and a tool that guesses here is the tool that eats
// someone's loop.

export const simon = {
  name: 'simon.simon',
  draft: ({ part, points, paths, Path, Point, measurements, options, macro, utils, store }) => {
    let current = new Point(0, 0)
    for (let i = 0; i < measurements.shoulderToShoulder; i += 10) {
      current = current.shift(-90, 10)
      points['cp' + i] = current
    }

    paths.seam = new Path().move(points.cp0).curve(points.cp10, points.cp20, current).close()

    if (options.collarEase > 0) {
      paths.collar = new Path().move(points.cp0).line(current)
    }

    store.set('simon.done', true)

    return part
  },
}
