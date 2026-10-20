// A measurement set for `aaron`, in millimetres.
//
// The ten names `aaron` declares as required, plus two it does not use at all —
// extra measurements are legal and must be ignored rather than refused.
// `shoulderSlope` is the one degree-valued measurement in the set.
//
// The numbers are a real male 38 from `@freesewing/models`, written out so the
// fixture is readable and the test carries no extra dependency.

export const aaronMeasurements = {
  biceps: 350,
  chest: 1000,
  hpsToBust: 280,
  hpsToWaistBack: 470,
  neck: 380,
  shoulderToShoulder: 450,
  shoulderSlope: 13,
  waistToArmpit: 210,
  waistToHips: 130,
  hips: 840,
  // Not used by aaron. Passed through to prove extras are accepted.
  waist: 800,
  seat: 950,
}
