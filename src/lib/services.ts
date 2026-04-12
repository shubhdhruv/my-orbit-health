// Complete service catalog with intake question definitions
// Each service has steps, and each step has one question (one-question-per-screen pattern)

export type QuestionType = "radio" | "checkbox" | "number" | "text" | "textarea" | "date" | "bmi" | "select" | "file-upload";

export interface QuestionOption {
  label: string;
  value: string;
  disqualifying?: boolean; // If true, selecting this flags the patient
}

export interface FormStep {
  id: string;
  question: string;
  subtitle?: string;
  type: QuestionType;
  options?: QuestionOption[];
  placeholder?: string;
  required?: boolean;
  conditionalOn?: { stepId: string; value: string }; // Only show if previous step has this value
  fields?: Array<{ id: string; label: string; placeholder: string; type: string }>; // For composite fields like BMI
}

export interface ServiceDefinition {
  id: string;
  label: string;
  category: "weight-loss" | "ed" | "hrt-male" | "hrt-female" | "peptide" | "blend";
  description: string;
  requiresBloodwork: boolean;
  bloodworkPanels?: string[];
  intakeSteps: FormStep[];
}

// ============================================================
// SHARED STEP: State selection (used by all services for routing)
// ============================================================

const STATE_STEP: FormStep = {
  id: "state",
  question: "What state do you live in?",
  subtitle: "We need this to match you with a licensed provider in your state.",
  type: "select",
  options: [
    { label: "Alabama", value: "AL" },
    { label: "Alaska", value: "AK" },
    { label: "Arizona", value: "AZ" },
    { label: "Arkansas", value: "AR" },
    { label: "California", value: "CA" },
    { label: "Colorado", value: "CO" },
    { label: "Connecticut", value: "CT" },
    { label: "Delaware", value: "DE" },
    { label: "District of Columbia", value: "DC" },
    { label: "Florida", value: "FL" },
    { label: "Georgia", value: "GA" },
    { label: "Hawaii", value: "HI" },
    { label: "Idaho", value: "ID" },
    { label: "Illinois", value: "IL" },
    { label: "Indiana", value: "IN" },
    { label: "Iowa", value: "IA" },
    { label: "Kansas", value: "KS" },
    { label: "Kentucky", value: "KY" },
    { label: "Louisiana", value: "LA" },
    { label: "Maine", value: "ME" },
    { label: "Maryland", value: "MD" },
    { label: "Massachusetts", value: "MA" },
    { label: "Michigan", value: "MI" },
    { label: "Minnesota", value: "MN" },
    { label: "Mississippi", value: "MS" },
    { label: "Missouri", value: "MO" },
    { label: "Montana", value: "MT" },
    { label: "Nebraska", value: "NE" },
    { label: "Nevada", value: "NV" },
    { label: "New Hampshire", value: "NH" },
    { label: "New Jersey", value: "NJ" },
    { label: "New Mexico", value: "NM" },
    { label: "New York", value: "NY" },
    { label: "North Carolina", value: "NC" },
    { label: "North Dakota", value: "ND" },
    { label: "Ohio", value: "OH" },
    { label: "Oklahoma", value: "OK" },
    { label: "Oregon", value: "OR" },
    { label: "Pennsylvania", value: "PA" },
    { label: "Rhode Island", value: "RI" },
    { label: "South Carolina", value: "SC" },
    { label: "South Dakota", value: "SD" },
    { label: "Tennessee", value: "TN" },
    { label: "Texas", value: "TX" },
    { label: "Utah", value: "UT" },
    { label: "Vermont", value: "VT" },
    { label: "Virginia", value: "VA" },
    { label: "Washington", value: "WA" },
    { label: "West Virginia", value: "WV" },
    { label: "Wisconsin", value: "WI" },
    { label: "Wyoming", value: "WY" },
  ],
};

// ============================================================
// GLP-1 WEIGHT LOSS (shared steps for semaglutide, tirzepatide, retatrutide)
// ============================================================

const GLP1_STEPS: FormStep[] = [
  {
    id: "bmi",
    question: "What is your current height and weight?",
    subtitle: "We'll calculate your BMI to check your eligibility",
    type: "bmi",
    fields: [
      { id: "weight", label: "Weight (pounds)", placeholder: "Enter your weight", type: "number" },
      { id: "feet", label: "Feet", placeholder: "Feet", type: "number" },
      { id: "inches", label: "Inches", placeholder: "Inches", type: "number" },
    ],
  },
  {
    id: "weight-loss-goal",
    question: "What is your weight loss goal?",
    subtitle: "This helps us determine the best treatment plan for you.",
    type: "radio",
    options: [
      { label: "1-20 lbs", value: "1-20" },
      { label: "21-50 lbs", value: "21-50" },
      { label: "50+ lbs", value: "50+" },
      { label: "I haven't decided yet", value: "undecided" },
    ],
  },
  {
    id: "bariatric-surgery",
    question: "Have you undergone bariatric or gastric bypass surgery?",
    subtitle: "This helps us ensure your safety and determine the best treatment option",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "medical-conditions",
    question: "Do you have any of these conditions?",
    subtitle: "This helps us ensure your safety",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Gallbladder disease or removal", value: "gallbladder" },
      { label: "Hypertension", value: "hypertension" },
      { label: "High cholesterol or triglycerides", value: "high-cholesterol" },
      { label: "Sleep apnea", value: "sleep-apnea" },
      { label: "Osteoarthritis", value: "osteoarthritis" },
      { label: "Mobility issues due to weight", value: "mobility" },
      { label: "GERD", value: "gerd" },
      { label: "PCOS with insulin resistance", value: "pcos" },
      { label: "Liver disease", value: "liver-disease" },
    ],
  },
  {
    id: "other-conditions",
    question: "Do you have any other medical conditions not already listed?",
    subtitle: "Be as specific as possible with any relevant details",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "other-conditions-detail",
    question: "Please describe your other medical conditions",
    type: "textarea",
    placeholder: "Describe your conditions...",
    conditionalOn: { stepId: "other-conditions", value: "yes" },
  },
  {
    id: "disqualifying-conditions",
    question: "Do any of these apply to you?",
    subtitle: "These conditions may affect your eligibility for treatment",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Gastroparesis (Paralysis of your intestines)", value: "gastroparesis", disqualifying: true },
      { label: "Triglycerides over 600 at any point", value: "triglycerides-600", disqualifying: true },
      { label: "Pancreatic cancer", value: "pancreatic-cancer", disqualifying: true },
      { label: "Pancreatitis", value: "pancreatitis", disqualifying: true },
      { label: "Type 1 Diabetes", value: "type-1-diabetes", disqualifying: true },
      { label: "Hypoglycemia (low blood sugar)", value: "hypoglycemia", disqualifying: true },
      { label: "Insulin-dependent diabetes", value: "insulin-dependent", disqualifying: true },
      { label: "Family history of thyroid cancer", value: "thyroid-cancer-family", disqualifying: true },
      { label: "Personal or family history of Multiple Endocrine Neoplasia (MEN-2) syndrome", value: "men-2", disqualifying: true },
    ],
  },
  {
    id: "disqualifying-medications",
    question: "Are you currently taking any of these medications?",
    subtitle: "Select all that apply",
    type: "checkbox",
    options: [
      { label: "None", value: "none" },
      { label: "Insulin", value: "insulin", disqualifying: true },
      { label: "Glimepiride (Amaryl)", value: "glimepiride", disqualifying: true },
      { label: "Meglitinides (e.g., repaglinide, nateglinide)", value: "meglitinides", disqualifying: true },
      { label: "Glipizide", value: "glipizide", disqualifying: true },
      { label: "Glyburide", value: "glyburide", disqualifying: true },
      { label: "Sitagliptin", value: "sitagliptin", disqualifying: true },
      { label: "Saxagliptin", value: "saxagliptin", disqualifying: true },
      { label: "Linagliptin", value: "linagliptin", disqualifying: true },
      { label: "Alogliptin", value: "alogliptin", disqualifying: true },
    ],
  },
  {
    id: "prior-glp1",
    question: "Have you taken a GLP-1 medication before?",
    subtitle: "This helps us personalize your starting dose so you don't have to re-titrate from scratch.",
    type: "radio",
    options: [
      { label: "No, this is my first time", value: "no" },
      { label: "Yes, I have taken a GLP-1 medication", value: "yes" },
    ],
  },
  {
    id: "prior-glp1-which",
    question: "Which GLP-1 medication were you on?",
    type: "radio",
    options: [
      { label: "Semaglutide (Ozempic / Wegovy)", value: "semaglutide" },
      { label: "Tirzepatide (Mounjaro / Zepbound)", value: "tirzepatide" },
      { label: "Retatrutide", value: "retatrutide" },
      { label: "Other / not sure", value: "other" },
    ],
    conditionalOn: { stepId: "prior-glp1", value: "yes" },
  },
  {
    id: "prior-glp1-dose-semaglutide",
    question: "What was your most recent dose?",
    subtitle: "Pick the highest dose you were stable on (tolerating well for at least 2 weeks).",
    type: "radio",
    options: [
      { label: "0.25 mg/week", value: "0.25" },
      { label: "0.5 mg/week", value: "0.5" },
      { label: "1.0 mg/week", value: "1.0" },
      { label: "1.7 mg/week", value: "1.7" },
      { label: "2.4 mg/week", value: "2.4" },
    ],
    conditionalOn: { stepId: "prior-glp1-which", value: "semaglutide" },
  },
  {
    id: "prior-glp1-dose-tirzepatide",
    question: "What was your most recent dose?",
    subtitle: "Pick the highest dose you were stable on (tolerating well for at least 2 weeks).",
    type: "radio",
    options: [
      { label: "2.5 mg/week", value: "2.5" },
      { label: "5 mg/week", value: "5" },
      { label: "7.5 mg/week", value: "7.5" },
      { label: "10 mg/week", value: "10" },
      { label: "12.5 mg/week", value: "12.5" },
      { label: "15 mg/week", value: "15" },
    ],
    conditionalOn: { stepId: "prior-glp1-which", value: "tirzepatide" },
  },
  {
    id: "prior-glp1-dose-retatrutide",
    question: "What was your most recent dose?",
    subtitle: "Pick the highest dose you were stable on (tolerating well for at least 2 weeks).",
    type: "radio",
    options: [
      { label: "2 mg/week", value: "2" },
      { label: "4 mg/week", value: "4" },
      { label: "8 mg/week", value: "8" },
      { label: "12 mg/week", value: "12" },
    ],
    conditionalOn: { stepId: "prior-glp1-which", value: "retatrutide" },
  },
  {
    id: "prior-glp1-timing",
    question: "When did you last take it?",
    subtitle: "GI tolerance can reset after a gap, so this affects where we can safely start you.",
    type: "radio",
    options: [
      { label: "I'm currently taking it", value: "current" },
      { label: "Stopped within the last 4 weeks", value: "under-4-weeks" },
      { label: "Stopped 4–8 weeks ago", value: "4-to-8-weeks" },
      { label: "Stopped more than 8 weeks ago", value: "over-8-weeks" },
    ],
    conditionalOn: { stepId: "prior-glp1", value: "yes" },
  },
  {
    id: "current-medications",
    question: "Are you currently taking any medications?",
    subtitle: "Some medications may affect your eligibility",
    type: "radio",
    options: [
      { label: "No, I don't take any medications", value: "no" },
      { label: "Yes, I take medications", value: "yes" },
    ],
  },
  {
    id: "current-medications-detail",
    question: "Please list your current medications",
    subtitle: "Include name, dosage, and frequency",
    type: "textarea",
    placeholder: "e.g., Metformin 500mg twice daily...",
    conditionalOn: { stepId: "current-medications", value: "yes" },
  },
  {
    id: "allergies",
    question: "Do you have any known drug allergies?",
    type: "radio",
    options: [
      { label: "No known allergies", value: "no" },
      { label: "Yes, I have allergies", value: "yes" },
    ],
  },
  {
    id: "allergies-detail",
    question: "Please list your allergies",
    type: "textarea",
    placeholder: "List any drug or food allergies...",
    conditionalOn: { stepId: "allergies", value: "yes" },
  },
  {
    id: "pregnancy",
    question: "Are you pregnant, breastfeeding, or planning to become pregnant?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes, I am pregnant", value: "pregnant", disqualifying: true },
      { label: "Yes, I am breastfeeding", value: "breastfeeding", disqualifying: true },
      { label: "Yes, I am planning to become pregnant", value: "planning", disqualifying: true },
      { label: "Not applicable", value: "na" },
    ],
  },
  {
    id: "patient-notes",
    question: "Anything else you'd like your doctor to know?",
    subtitle: "Share any additional information, questions, or concerns that may be helpful for your consultation.",
    type: "textarea",
    placeholder: "Type your notes here... (optional)",
    required: false,
  },
];

// ============================================================
// ED MEDICATIONS (sildenafil, tadalafil)
// ============================================================

const ED_STEPS: FormStep[] = [
  {
    id: "ed-symptoms",
    question: "How would you describe your erectile dysfunction?",
    subtitle: "This helps us determine the right treatment for you",
    type: "radio",
    options: [
      { label: "I can never get an erection", value: "severe" },
      { label: "I can get an erection but can't maintain it", value: "moderate" },
      { label: "I occasionally have difficulty", value: "mild" },
      { label: "I want to improve my performance", value: "enhancement" },
    ],
  },
  {
    id: "ed-duration",
    question: "How long have you been experiencing these symptoms?",
    type: "radio",
    options: [
      { label: "Less than 3 months", value: "less-3-months" },
      { label: "3-6 months", value: "3-6-months" },
      { label: "6-12 months", value: "6-12-months" },
      { label: "More than 1 year", value: "over-1-year" },
    ],
  },
  {
    id: "blood-pressure",
    question: "What is your most recent blood pressure reading?",
    subtitle: "You can check at a pharmacy or with a home monitor",
    type: "text",
    placeholder: "e.g., 120/80",
  },
  {
    id: "cardiovascular-conditions",
    question: "Do any of these apply to you?",
    subtitle: "These conditions may affect your eligibility for ED medication",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Heart attack in the last 90 days", value: "recent-mi", disqualifying: true },
      { label: "Stroke in the last 6 months", value: "recent-stroke", disqualifying: true },
      { label: "Unstable angina or chest pain during sexual activity", value: "unstable-angina", disqualifying: true },
      { label: "Heart failure", value: "heart-failure" },
      { label: "Uncontrolled high blood pressure", value: "uncontrolled-bp", disqualifying: true },
      { label: "Low blood pressure (below 90/50)", value: "low-bp", disqualifying: true },
      { label: "Heart arrhythmia", value: "arrhythmia" },
      { label: "History of heart surgery, stenting, or bypass", value: "heart-surgery" },
    ],
  },
  {
    id: "nitrate-medications",
    question: "Do you take any nitrate medications?",
    subtitle: "This is critically important — nitrates combined with ED medication can cause a dangerous drop in blood pressure",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Nitroglycerin (tablets, patches, or spray)", value: "nitroglycerin", disqualifying: true },
      { label: "Isosorbide mononitrate (Imdur)", value: "isosorbide-mono", disqualifying: true },
      { label: "Isosorbide dinitrate (Isordil)", value: "isosorbide-di", disqualifying: true },
      { label: 'Amyl nitrite or "poppers" (recreational)', value: "poppers", disqualifying: true },
    ],
  },
  {
    id: "alpha-blockers",
    question: "Do you take any of these prostate or blood pressure medications?",
    subtitle: "These may require a lower starting dose",
    type: "checkbox",
    options: [
      { label: "None", value: "none" },
      { label: "Tamsulosin (Flomax)", value: "tamsulosin" },
      { label: "Doxazosin (Cardura)", value: "doxazosin" },
      { label: "Terazosin (Hytrin)", value: "terazosin" },
      { label: "Alfuzosin (Uroxatral)", value: "alfuzosin" },
      { label: "Prazosin (Minipress)", value: "prazosin" },
    ],
  },
  {
    id: "priapism-risk",
    question: "Do any of these apply to you?",
    subtitle: "These conditions increase the risk of priapism (prolonged erection)",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Sickle cell disease", value: "sickle-cell", disqualifying: true },
      { label: "Multiple myeloma", value: "multiple-myeloma", disqualifying: true },
      { label: "Leukemia", value: "leukemia", disqualifying: true },
      { label: "Peyronie's disease (penile deformity)", value: "peyronies" },
      { label: "History of priapism (erection lasting over 4 hours)", value: "priapism-history", disqualifying: true },
    ],
  },
  {
    id: "vision-hearing",
    question: "Have you experienced any of the following?",
    subtitle: "These may affect your eligibility",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Sudden loss of vision in one or both eyes", value: "vision-loss", disqualifying: true },
      { label: "Non-arteritic anterior ischemic optic neuropathy (NAION)", value: "naion", disqualifying: true },
      { label: "Retinitis pigmentosa", value: "retinitis-pigmentosa", disqualifying: true },
      { label: "Sudden decrease or loss of hearing", value: "hearing-loss", disqualifying: true },
    ],
  },
  {
    id: "liver-kidney",
    question: "Do you have any liver or kidney conditions?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Mild liver or kidney issues", value: "mild" },
      { label: "Severe liver or kidney disease", value: "severe", disqualifying: true },
    ],
  },
  {
    id: "ed-current-medications",
    question: "Are you currently taking any medications?",
    subtitle: "Include prescriptions, supplements, and over-the-counter medications",
    type: "radio",
    options: [
      { label: "No, I don't take any medications", value: "no" },
      { label: "Yes, I take medications", value: "yes" },
    ],
  },
  {
    id: "ed-current-medications-detail",
    question: "Please list all current medications",
    subtitle: "Include HIV medications, antifungals, blood thinners, and any supplements",
    type: "textarea",
    placeholder: "List medication name, dosage, and frequency...",
    conditionalOn: { stepId: "ed-current-medications", value: "yes" },
  },
  {
    id: "ed-previous-treatment",
    question: "Have you used ED medication before?",
    type: "radio",
    options: [
      { label: "No, this is my first time", value: "no" },
      { label: "Yes, I have used ED medication", value: "yes" },
    ],
  },
  {
    id: "ed-prior-which",
    question: "Which ED medication were you on?",
    type: "radio",
    options: [
      { label: "Sildenafil (Viagra)", value: "sildenafil" },
      { label: "Tadalafil (Cialis)", value: "tadalafil" },
      { label: "Other / not sure", value: "other" },
    ],
    conditionalOn: { stepId: "ed-previous-treatment", value: "yes" },
  },
  {
    id: "ed-prior-dose-sildenafil",
    question: "What dose were you taking?",
    type: "radio",
    options: [
      { label: "25 mg", value: "25" },
      { label: "50 mg", value: "50" },
      { label: "100 mg", value: "100" },
    ],
    conditionalOn: { stepId: "ed-prior-which", value: "sildenafil" },
  },
  {
    id: "ed-prior-dose-tadalafil",
    question: "What dose were you taking?",
    type: "radio",
    options: [
      { label: "2.5 mg daily", value: "2.5" },
      { label: "5 mg daily", value: "5" },
      { label: "10 mg as needed", value: "10" },
      { label: "20 mg as needed", value: "20" },
    ],
    conditionalOn: { stepId: "ed-prior-which", value: "tadalafil" },
  },
  {
    id: "ed-prior-response",
    question: "How well did it work for you?",
    type: "radio",
    options: [
      { label: "Worked great", value: "good" },
      { label: "Partially — could be better", value: "partial" },
      { label: "Didn't work", value: "none" },
      { label: "Had side effects and stopped", value: "side-effects" },
    ],
    conditionalOn: { stepId: "ed-previous-treatment", value: "yes" },
  },
  {
    id: "sexual-activity-safety",
    question: "Has a doctor ever told you that sexual activity is unsafe for you?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", disqualifying: true },
    ],
  },
  {
    id: "ed-patient-notes",
    question: "Anything else you'd like your doctor to know?",
    subtitle: "Share any additional information, questions, or concerns.",
    type: "textarea",
    placeholder: "Type your notes here... (optional)",
    required: false,
  },
];

// ============================================================
// TESTOSTERONE (injectable & oral — shared steps)
// ============================================================

const TESTOSTERONE_STEPS: FormStep[] = [
  {
    id: "testosterone-symptoms",
    question: "What symptoms are you experiencing?",
    subtitle: "Select all that apply",
    type: "checkbox",
    options: [
      { label: "Fatigue / low energy", value: "fatigue" },
      { label: "Low libido / decreased sex drive", value: "low-libido" },
      { label: "Erectile dysfunction", value: "ed" },
      { label: "Mood changes / irritability", value: "mood-changes" },
      { label: "Decreased muscle mass", value: "muscle-loss" },
      { label: "Increased body fat", value: "body-fat" },
      { label: "Brain fog / difficulty concentrating", value: "brain-fog" },
      { label: "Depression", value: "depression" },
      { label: "Sleep problems", value: "sleep-issues" },
      { label: "Hair loss", value: "hair-loss" },
    ],
  },
  {
    id: "symptom-duration",
    question: "How long have you been experiencing these symptoms?",
    type: "radio",
    options: [
      { label: "Less than 3 months", value: "less-3-months" },
      { label: "3-6 months", value: "3-6-months" },
      { label: "6-12 months", value: "6-12-months" },
      { label: "More than 1 year", value: "over-1-year" },
    ],
  },
  {
    id: "bloodwork-status",
    question: "Do you have recent bloodwork results?",
    subtitle: "Testosterone therapy requires blood work within the last 6 months",
    type: "radio",
    options: [
      { label: "Yes, I'll upload my labs (within last 6 months)", value: "have-labs" },
      { label: "No — purchase the HRT Clearance Kit ($5, charged today and shipped to you)", value: "buy-kit" },
    ],
  },
  {
    id: "bloodwork-upload",
    question: "Upload your recent lab results",
    subtitle: "We need: total testosterone, free testosterone, CBC, CMP, lipid panel, and PSA (if 40+)",
    type: "file-upload",
    conditionalOn: { stepId: "bloodwork-status", value: "have-labs" },
  },
  {
    id: "testosterone-contraindications",
    question: "Do any of these apply to you?",
    subtitle: "These conditions may affect your eligibility for testosterone therapy",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Prostate cancer (current or history)", value: "prostate-cancer", disqualifying: true },
      { label: "Male breast cancer", value: "breast-cancer", disqualifying: true },
      { label: "Hematocrit above 54%", value: "high-hematocrit", disqualifying: true },
      { label: "Untreated severe sleep apnea", value: "severe-sleep-apnea", disqualifying: true },
      { label: "Uncontrolled heart failure", value: "heart-failure", disqualifying: true },
      { label: "Blood clots (DVT or PE)", value: "blood-clots", disqualifying: true },
      { label: "Polycythemia (too many red blood cells)", value: "polycythemia", disqualifying: true },
    ],
  },
  {
    id: "fertility-goals",
    question: "Do you plan to father children in the near future?",
    subtitle: "Important: Testosterone therapy significantly reduces sperm production",
    type: "radio",
    options: [
      { label: "No, I do not plan to have children", value: "no" },
      { label: "Yes, I want to preserve fertility", value: "yes" },
      { label: "I'm unsure", value: "unsure" },
    ],
  },
  {
    id: "cardiovascular-history",
    question: "Do you have any cardiovascular conditions?",
    type: "checkbox",
    options: [
      { label: "None", value: "none" },
      { label: "History of heart attack", value: "heart-attack" },
      { label: "History of stroke", value: "stroke" },
      { label: "High blood pressure", value: "high-bp" },
      { label: "Heart failure", value: "heart-failure" },
    ],
  },
  {
    id: "steroid-history",
    question: "Have you used anabolic steroids or testosterone before?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes, prescribed by a doctor", value: "prescribed" },
      { label: "Yes, self-administered", value: "self" },
    ],
  },
  {
    id: "testosterone-medications",
    question: "Are you currently taking any medications?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "testosterone-medications-detail",
    question: "Please list all current medications",
    type: "textarea",
    placeholder: "Include name, dosage, and frequency...",
    conditionalOn: { stepId: "testosterone-medications", value: "yes" },
  },
  {
    id: "mental-health",
    question: "Have you experienced any of the following?",
    subtitle: "This helps us monitor your care",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Depression requiring treatment", value: "depression" },
      { label: "Anxiety requiring treatment", value: "anxiety" },
      { label: "History of suicidal thoughts", value: "suicidal-thoughts" },
      { label: "Mood instability", value: "mood-instability" },
    ],
  },
  {
    id: "testosterone-patient-notes",
    question: "Anything else you'd like your doctor to know?",
    subtitle: "Share any additional information, questions, or concerns.",
    type: "textarea",
    placeholder: "Type your notes here... (optional)",
    required: false,
  },
];

// ============================================================
// ENCLOMIPHENE
// ============================================================

const ENCLOMIPHENE_STEPS: FormStep[] = [
  ...TESTOSTERONE_STEPS.slice(0, 2), // symptoms + duration
  {
    id: "bloodwork-status",
    question: "Do you have recent bloodwork results?",
    subtitle: "Enclomiphene therapy requires labs within the last 3 months including: total testosterone, free testosterone, LH, FSH, estradiol",
    type: "radio",
    options: [
      { label: "Yes, I'll upload my labs (within last 3 months)", value: "have-labs" },
      { label: "No — purchase the HRT Clearance Kit ($5, charged today and shipped to you)", value: "buy-kit" },
    ],
  },
  TESTOSTERONE_STEPS.find(s => s.id === "bloodwork-upload")!,
  {
    id: "enclomiphene-contraindications",
    question: "Do any of these apply to you?",
    subtitle: "These conditions may affect your eligibility",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Liver disease", value: "liver-disease", disqualifying: true },
      { label: "Uncontrolled thyroid disorder", value: "thyroid", disqualifying: true },
      { label: "Uncontrolled adrenal disorder", value: "adrenal", disqualifying: true },
      { label: "History of blood clots (DVT, PE, stroke)", value: "blood-clots" },
      { label: "Cardiovascular disease", value: "cardiovascular" },
      { label: "Visual disturbances or vision changes", value: "vision" },
    ],
  },
  TESTOSTERONE_STEPS.find(s => s.id === "fertility-goals")!,
  TESTOSTERONE_STEPS.find(s => s.id === "testosterone-medications")!,
  TESTOSTERONE_STEPS.find(s => s.id === "testosterone-medications-detail")!,
  TESTOSTERONE_STEPS.find(s => s.id === "testosterone-patient-notes")!,
];

// ============================================================
// ESTROGEN (cream & patches — shared steps)
// ============================================================

const ESTROGEN_STEPS: FormStep[] = [
  {
    id: "menopause-symptoms",
    question: "What symptoms are you experiencing?",
    subtitle: "Select all that apply",
    type: "checkbox",
    options: [
      { label: "Hot flashes", value: "hot-flashes" },
      { label: "Night sweats", value: "night-sweats" },
      { label: "Vaginal dryness", value: "vaginal-dryness" },
      { label: "Mood changes", value: "mood-changes" },
      { label: "Sleep disruption", value: "sleep-disruption" },
      { label: "Low libido", value: "low-libido" },
      { label: "Brain fog", value: "brain-fog" },
      { label: "Joint pain", value: "joint-pain" },
      { label: "Weight gain", value: "weight-gain" },
      { label: "Fatigue", value: "fatigue" },
    ],
  },
  {
    id: "menstrual-history",
    question: "What is your menstrual status?",
    type: "radio",
    options: [
      { label: "I still have regular periods", value: "regular" },
      { label: "My periods are irregular", value: "irregular" },
      { label: "I haven't had a period in over 12 months", value: "postmenopausal" },
      { label: "I've had a hysterectomy", value: "hysterectomy" },
    ],
  },
  {
    id: "bloodwork-status",
    question: "Do you have recent bloodwork results?",
    subtitle: "We need: FSH, estradiol, CBC, CMP, lipid panel, and thyroid panel",
    type: "radio",
    options: [
      { label: "Yes, I'll upload my labs (within last 6 months)", value: "have-labs" },
      { label: "No — purchase the HRT Clearance Kit ($5, charged today and shipped to you)", value: "buy-kit" },
    ],
  },
  {
    id: "bloodwork-upload",
    question: "Upload your recent lab results",
    type: "file-upload",
    conditionalOn: { stepId: "bloodwork-status", value: "have-labs" },
  },
  {
    id: "estrogen-contraindications",
    question: "Do any of these apply to you?",
    subtitle: "These conditions may affect your eligibility for estrogen therapy",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Breast cancer (current or history)", value: "breast-cancer", disqualifying: true },
      { label: "Endometrial or ovarian cancer", value: "endometrial-cancer", disqualifying: true },
      { label: "Blood clots (DVT or PE)", value: "blood-clots", disqualifying: true },
      { label: "Heart attack or stroke", value: "mi-stroke", disqualifying: true },
      { label: "Active liver disease", value: "liver-disease", disqualifying: true },
      { label: "Unexplained vaginal bleeding", value: "unexplained-bleeding", disqualifying: true },
      { label: "Known blood clotting disorder (e.g., Factor V Leiden)", value: "clotting-disorder", disqualifying: true },
    ],
  },
  {
    id: "mammogram",
    question: "Have you had a mammogram in the last year?",
    type: "radio",
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
      { label: "I'm under 40 and haven't been recommended one", value: "not-applicable" },
    ],
  },
  {
    id: "smoking-status",
    question: "Do you currently smoke?",
    subtitle: "Smoking increases the risk of blood clots with estrogen therapy",
    type: "radio",
    options: [
      { label: "No, I don't smoke", value: "no" },
      { label: "Yes, I smoke", value: "yes" },
      { label: "I recently quit (within 6 months)", value: "recently-quit" },
    ],
  },
  {
    id: "pregnancy-status",
    question: "Are you pregnant or could you be pregnant?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes or possibly", value: "yes", disqualifying: true },
    ],
  },
  {
    id: "estrogen-medications",
    question: "Are you currently taking any medications?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "estrogen-medications-detail",
    question: "Please list all current medications",
    subtitle: "Especially thyroid medications, blood thinners, and seizure medications",
    type: "textarea",
    placeholder: "Include name, dosage, and frequency...",
    conditionalOn: { stepId: "estrogen-medications", value: "yes" },
  },
  {
    id: "family-history",
    question: "Do you have a family history of any of these?",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Breast cancer", value: "breast-cancer" },
      { label: "Ovarian cancer", value: "ovarian-cancer" },
      { label: "Blood clots", value: "blood-clots" },
      { label: "Early cardiovascular disease", value: "cardiovascular" },
    ],
  },
  {
    id: "estrogen-patient-notes",
    question: "Anything else you'd like your doctor to know?",
    subtitle: "Share any additional information, questions, or concerns.",
    type: "textarea",
    placeholder: "Type your notes here... (optional)",
    required: false,
  },
];

// ============================================================
// PEPTIDES (shared base for MOTS-c, NAD+, BPC-157, TB-500)
// ============================================================

const PEPTIDE_BASE_STEPS: FormStep[] = [
  {
    id: "peptide-goals",
    question: "What is your primary goal for this therapy?",
    subtitle: "This helps us personalize your treatment",
    type: "radio",
    options: [
      { label: "Injury recovery / tissue repair", value: "recovery" },
      { label: "Anti-aging / longevity", value: "anti-aging" },
      { label: "Athletic performance", value: "performance" },
      { label: "Gut health", value: "gut-health" },
      { label: "General wellness", value: "wellness" },
    ],
  },
  {
    id: "cancer-history",
    question: "Do you have any history of cancer?",
    subtitle: "This is critically important for peptide therapy safety",
    type: "radio",
    options: [
      { label: "No cancer history", value: "none" },
      { label: "Yes, currently being treated", value: "active", disqualifying: true },
      { label: "Yes, in remission (within 5 years)", value: "remission-recent", disqualifying: true },
      { label: "Yes, in remission (over 5 years ago)", value: "remission-long" },
    ],
  },
  {
    id: "peptide-contraindications",
    question: "Do any of these apply to you?",
    subtitle: "These conditions may affect your eligibility",
    type: "checkbox",
    options: [
      { label: "None of the below", value: "none" },
      { label: "Autoimmune disease (lupus, RA, MS, Hashimoto's)", value: "autoimmune" },
      { label: "Organ transplant", value: "transplant", disqualifying: true },
      { label: "Currently on immunosuppressants", value: "immunosuppressants" },
      { label: "Active infection", value: "active-infection" },
      { label: "Bleeding disorder", value: "bleeding-disorder" },
      { label: "Liver disease", value: "liver-disease" },
      { label: "Kidney disease", value: "kidney-disease" },
    ],
  },
  {
    id: "blood-thinners",
    question: "Are you taking any blood-thinning medications?",
    type: "checkbox",
    options: [
      { label: "None", value: "none" },
      { label: "Warfarin (Coumadin)", value: "warfarin" },
      { label: "Eliquis (apixaban)", value: "eliquis" },
      { label: "Xarelto (rivarobaxan)", value: "xarelto" },
      { label: "Aspirin (daily)", value: "aspirin" },
      { label: "Plavix (clopidogrel)", value: "plavix" },
    ],
  },
  {
    id: "peptide-previous",
    question: "Have you used peptide therapy before?",
    type: "radio",
    options: [
      { label: "No, this is my first time", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "peptide-previous-detail",
    question: "Which peptides have you used, and did you have any adverse reactions?",
    type: "textarea",
    placeholder: "e.g., BPC-157 for 4 weeks, no issues...",
    conditionalOn: { stepId: "peptide-previous", value: "yes" },
  },
  {
    id: "peptide-pregnancy",
    question: "Are you pregnant, breastfeeding, or planning to become pregnant?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", disqualifying: true },
      { label: "Not applicable", value: "na" },
    ],
  },
  {
    id: "competitive-athlete",
    question: "Are you a competitive athlete subject to drug testing?",
    subtitle: "All peptides on this list are prohibited by WADA",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "peptide-medications",
    question: "Are you currently taking any medications?",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "peptide-medications-detail",
    question: "Please list all current medications and supplements",
    type: "textarea",
    placeholder: "Include name, dosage, and frequency...",
    conditionalOn: { stepId: "peptide-medications", value: "yes" },
  },
  {
    id: "peptide-allergies",
    question: "Do you have any allergies to injectable medications or peptides?",
    type: "radio",
    options: [
      { label: "No known allergies", value: "no" },
      { label: "Yes", value: "yes" },
    ],
  },
  {
    id: "peptide-allergies-detail",
    question: "Please describe your allergies",
    subtitle: "Include any reactions to bacteriostatic water, mannitol, or benzyl alcohol",
    type: "textarea",
    placeholder: "Describe your allergies...",
    conditionalOn: { stepId: "peptide-allergies", value: "yes" },
  },
  {
    id: "peptide-patient-notes",
    question: "Anything else you'd like your doctor to know?",
    subtitle: "Share any additional information, questions, or concerns.",
    type: "textarea",
    placeholder: "Type your notes here... (optional)",
    required: false,
  },
];

// MOTS-c adds diabetes/metabolic screening
const MOTSC_EXTRA_STEPS: FormStep[] = [
  {
    id: "diabetes-screening",
    question: "Do you have diabetes or metabolic conditions?",
    subtitle: "MOTS-c affects blood sugar — this is important for dosing safety",
    type: "checkbox",
    options: [
      { label: "None", value: "none" },
      { label: "Type 1 Diabetes", value: "type-1", disqualifying: true },
      { label: "Type 2 Diabetes", value: "type-2" },
      { label: "Insulin resistance / pre-diabetes", value: "insulin-resistance" },
      { label: "Currently on metformin", value: "metformin" },
      { label: "Currently on insulin", value: "insulin" },
      { label: "Currently on a GLP-1 medication", value: "glp1" },
    ],
  },
];

// NAD+ adds cardiovascular/gout screening
const NAD_EXTRA_STEPS: FormStep[] = [
  {
    id: "nad-cardiovascular",
    question: "Do any of these cardiovascular conditions apply to you?",
    subtitle: "NAD+ can affect blood pressure",
    type: "checkbox",
    options: [
      { label: "None", value: "none" },
      { label: "Unstable angina or recent heart attack", value: "unstable-angina", disqualifying: true },
      { label: "Low blood pressure (systolic below 100)", value: "low-bp", disqualifying: true },
      { label: "Uncontrolled arrhythmia", value: "arrhythmia" },
      { label: "Currently on blood pressure medication", value: "bp-meds" },
    ],
  },
  {
    id: "nad-gout",
    question: "Do you have a history of gout?",
    subtitle: "NAD+ precursors can elevate uric acid levels",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes, currently managed", value: "managed" },
      { label: "Yes, currently experiencing a flare", value: "active-flare" },
    ],
  },
  {
    id: "nad-parp",
    question: "Are you currently taking any PARP inhibitor cancer medications?",
    subtitle: "NAD+ directly interferes with PARP inhibitor treatment",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", disqualifying: true },
    ],
  },
];

// GLO/KLOW add copper screening
const GLO_EXTRA_STEPS: FormStep[] = [
  {
    id: "copper-metabolism",
    question: "Do you have Wilson's disease or any copper metabolism disorder?",
    subtitle: "This blend contains GHK-Cu (copper peptide)",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", disqualifying: true },
    ],
  },
];

const KLOW_EXTRA_STEPS: FormStep[] = [
  ...GLO_EXTRA_STEPS,
  {
    id: "melanoma-history",
    question: "Do you have any history of melanoma or skin cancer?",
    subtitle: "This blend contains KPV, which acts on melanocortin pathways",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes", value: "yes", disqualifying: true },
    ],
  },
  {
    id: "ibd-status",
    question: "Do you have inflammatory bowel disease?",
    subtitle: "KPV is often used for gut inflammation — we need to know your current status",
    type: "radio",
    options: [
      { label: "No", value: "no" },
      { label: "Yes, Crohn's disease", value: "crohns" },
      { label: "Yes, ulcerative colitis", value: "uc" },
      { label: "Yes, other IBD", value: "other" },
    ],
  },
];

// Tadalafil: PRN vs daily preference — drives dosing engine mode selection
const TADALAFIL_DOSING_PREFERENCE: FormStep = {
  id: "dosing_preference",
  question: "How would you prefer to take your medication?",
  subtitle: "Your doctor will confirm the best option for you",
  type: "radio",
  options: [
    { label: "As needed before sexual activity (works up to 36 hours)", value: "prn" },
    { label: "Daily low dose for spontaneous readiness", value: "daily" },
    { label: "I'm not sure — let my doctor decide", value: "prn" },
  ],
};

// Off-label informed consent — required for all peptides and blends
const OFF_LABEL_CONSENT_STEP: FormStep = {
  id: "off_label_informed_consent_signed",
  question: "Off-Label / Investigational Compound Consent",
  subtitle: "This therapy uses a compounded peptide that is not FDA-approved for any indication. It is prescribed off-label based on your doctor's clinical judgment. By proceeding, you acknowledge that you understand this is not an FDA-approved treatment, that long-term safety data may be limited, and that you consent to off-label prescribing. Your doctor will review this with you on your video visit.",
  type: "radio",
  options: [
    { label: "I understand and consent to proceed", value: "yes" },
    { label: "I do not consent", value: "no", disqualifying: true },
  ],
};

// ============================================================
// SERVICE CATALOG
// ============================================================

export const SERVICE_CATALOG: ServiceDefinition[] = [
  // GLP-1 Weight Loss
  {
    id: "semaglutide",
    label: "Semaglutide (GLP-1 Weight Loss)",
    category: "weight-loss",
    description: "FDA-approved GLP-1 weight management program",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...GLP1_STEPS],
  },
  {
    id: "tirzepatide",
    label: "Tirzepatide (GLP-1 Weight Loss)",
    category: "weight-loss",
    description: "Dual GIP/GLP-1 weight management program",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...GLP1_STEPS],
  },
  {
    id: "retatrutide",
    label: "Retatrutide (Triple Agonist Weight Loss)",
    category: "weight-loss",
    description: "Triple hormone receptor agonist for weight management",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...GLP1_STEPS, OFF_LABEL_CONSENT_STEP],
  },

  // ED Medications
  {
    id: "sildenafil",
    label: "Sildenafil (Viagra)",
    category: "ed",
    description: "On-demand erectile dysfunction treatment",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...ED_STEPS],
  },
  {
    id: "tadalafil",
    label: "Tadalafil (Cialis)",
    category: "ed",
    description: "Daily or on-demand erectile dysfunction treatment",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...ED_STEPS, TADALAFIL_DOSING_PREFERENCE],
  },

  // HRT Male
  {
    id: "testosterone-injectable",
    label: "Testosterone Injectable",
    category: "hrt-male",
    description: "Testosterone cypionate/enanthate injection therapy",
    requiresBloodwork: true,
    bloodworkPanels: ["Total Testosterone", "Free Testosterone", "SHBG", "LH", "FSH", "Estradiol", "Prolactin", "CBC", "CMP", "Lipid Panel", "PSA (40+)", "TSH"],
    intakeSteps: [STATE_STEP, ...TESTOSTERONE_STEPS],
  },
  {
    id: "testosterone-oral",
    label: "Testosterone Oral",
    category: "hrt-male",
    description: "Oral testosterone undecanoate therapy",
    requiresBloodwork: true,
    bloodworkPanels: ["Total Testosterone", "Free Testosterone", "SHBG", "LH", "FSH", "Estradiol", "Prolactin", "CBC", "CMP", "Lipid Panel", "PSA (40+)", "TSH"],
    intakeSteps: [STATE_STEP, ...TESTOSTERONE_STEPS],
  },
  {
    id: "enclomiphene",
    label: "Enclomiphene",
    category: "hrt-male",
    description: "Fertility-preserving male hormone optimization",
    requiresBloodwork: true,
    bloodworkPanels: ["Total Testosterone", "Free Testosterone", "LH", "FSH", "Estradiol", "SHBG", "CBC", "CMP", "Lipid Panel", "Prolactin"],
    intakeSteps: [STATE_STEP, ...ENCLOMIPHENE_STEPS],
  },

  // HRT Female
  {
    id: "estrogen-cream-vaginal",
    label: "Estrogen Cream (Vaginal/GSM)",
    category: "hrt-female",
    description: "Vaginal estradiol cream for genitourinary syndrome of menopause",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...ESTROGEN_STEPS],
  },
  {
    id: "estrogen-cream-systemic",
    label: "Estrogen Cream (Systemic/Topical)",
    category: "hrt-female",
    description: "Topical estradiol cream for systemic menopause symptom relief",
    requiresBloodwork: true,
    bloodworkPanels: ["FSH", "Estradiol", "TSH", "Free T4", "CBC", "CMP", "Lipid Panel", "Fasting Glucose"],
    intakeSteps: [STATE_STEP, ...ESTROGEN_STEPS],
  },
  {
    id: "estrogen-patches",
    label: "Estrogen Patches",
    category: "hrt-female",
    description: "Transdermal estradiol patches for menopause symptom relief",
    requiresBloodwork: true,
    bloodworkPanels: ["FSH", "Estradiol", "TSH", "Free T4", "CBC", "CMP", "Lipid Panel", "Fasting Glucose"],
    intakeSteps: [STATE_STEP, ...ESTROGEN_STEPS],
  },

  // Peptides
  {
    id: "mots-c",
    label: "MOTS-c",
    category: "peptide",
    description: "Mitochondrial peptide for metabolic optimization",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...MOTSC_EXTRA_STEPS, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },
  {
    id: "nad",
    label: "NAD+",
    category: "peptide",
    description: "Cellular energy and DNA repair coenzyme therapy",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...NAD_EXTRA_STEPS, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },
  {
    id: "bpc-157",
    label: "BPC-157",
    category: "peptide",
    description: "Body protection compound for tissue repair",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },
  {
    id: "tb-500",
    label: "TB-500",
    category: "peptide",
    description: "Thymosin beta-4 for injury recovery and flexibility",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },

  // Blends
  {
    id: "wolverine",
    label: "Wolverine Blend",
    category: "blend",
    description: "BPC-157 + TB-500 regenerative healing combination",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },
  {
    id: "glo",
    label: "GLO Blend",
    category: "blend",
    description: "GHK-Cu + BPC-157 + TB-500 for skin and tissue regeneration",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...GLO_EXTRA_STEPS, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },
  {
    id: "klow",
    label: "KLOW Blend",
    category: "blend",
    description: "GHK-Cu + BPC-157 + TB-500 + KPV for regeneration and inflammation",
    requiresBloodwork: false,
    intakeSteps: [STATE_STEP, ...KLOW_EXTRA_STEPS, ...PEPTIDE_BASE_STEPS, OFF_LABEL_CONSENT_STEP],
  },
];

export function getServiceById(id: string): ServiceDefinition | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id);
}

export function getServicesByCategory(category: ServiceDefinition["category"]): ServiceDefinition[] {
  return SERVICE_CATALOG.filter((s) => s.category === category);
}
