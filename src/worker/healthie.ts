// Healthie GraphQL API integration
// Sandbox: https://staging-api.gethealthie.com/graphql
// Production: https://api.gethealthie.com/graphql

const HEALTHIE_SANDBOX_URL = "https://staging-api.gethealthie.com/graphql";
const HEALTHIE_PROD_URL = "https://api.gethealthie.com/graphql";

interface HealthieClient {
  apiKey: string;
  baseUrl: string;
}

export function createHealthieClient(apiKey: string): HealthieClient {
  const isSandbox = apiKey.startsWith("gh_sbox_");
  return {
    apiKey,
    baseUrl: isSandbox ? HEALTHIE_SANDBOX_URL : HEALTHIE_PROD_URL,
  };
}

async function gql(client: HealthieClient, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(client.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${client.apiKey}`,
      AuthorizationSource: "API",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (json.errors) {
    throw new Error(`Healthie API error: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data;
}

// ============================================================
// User Groups (one per influencer)
// ============================================================

export async function createUserGroup(client: HealthieClient, name: string): Promise<string> {
  const data = (await gql(client, `
    mutation CreateGroup($name: String) {
      createGroup(input: { name: $name }) {
        user_group {
          id
          name
        }
        messages {
          field
          message
        }
      }
    }
  `, { name })) as { createGroup: { user_group: { id: string } } };

  return data.createGroup.user_group.id;
}

// ============================================================
// Custom Module Forms (intake questionnaires)
// ============================================================

export async function createCustomModuleForm(
  client: HealthieClient,
  name: string
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateCustomModuleForm($name: String) {
      createCustomModuleForm(input: { name: $name, use_for_charting: false }) {
        customModuleForm {
          id
          name
        }
        messages {
          field
          message
        }
      }
    }
  `, { name })) as { createCustomModuleForm: { customModuleForm: { id: string } | null; messages: Array<{ field: string; message: string }> } };

  const result = data.createCustomModuleForm;
  if (!result.customModuleForm) {
    const msgs = result.messages?.map(m => `${m.field}: ${m.message}`).join(", ") || "unknown error";
    throw new Error(`Failed to create form "${name}": ${msgs}`);
  }
  return result.customModuleForm.id;
}

export interface CustomModuleInput {
  label: string;
  sublabel?: string;
  modType: string; // text, textarea, radio, checkbox, dropdown, number, date, etc.
  options?: string; // newline-separated options for radio/checkbox/dropdown
  required?: boolean;
  index: number;
}

export async function createCustomModule(
  client: HealthieClient,
  formId: string,
  module: CustomModuleInput
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateCustomModule(
      $formId: String,
      $label: String,
      $sublabel: String,
      $modType: String,
      $options: String,
      $required: Boolean,
      $index: Int
    ) {
      createCustomModule(input: {
        custom_module_form_id: $formId,
        label: $label,
        sublabel: $sublabel,
        mod_type: $modType,
        options: $options,
        required: $required,
        index: $index,
        is_custom: true
      }) {
        customModule {
          id
          label
          mod_type
        }
        messages {
          field
          message
        }
      }
    }
  `, {
    formId,
    label: module.label,
    sublabel: module.sublabel || "",
    modType: module.modType,
    options: module.options || "",
    required: module.required ?? true,
    index: module.index,
  })) as { createCustomModule: { customModule: { id: string } | null; messages: Array<{ field: string; message: string }> } };

  const result = data.createCustomModule;
  if (!result.customModule) {
    const msgs = result.messages?.map(m => `${m.field}: ${m.message}`).join(", ") || "unknown error";
    throw new Error(`Failed to create module "${module.label}" (index ${module.index}): ${msgs}`);
  }
  return result.customModule.id;
}

// ============================================================
// Onboarding Flows (auto-assign forms to groups)
// ============================================================

export async function createOnboardingFlow(
  client: HealthieClient,
  name: string,
  groupId: string
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateOnboardingFlow($name: String, $groups: String) {
      createOnboardingFlow(input: {
        name: $name,
        groups_to_use_onboarding_flow: $groups
      }) {
        onboardingFlow {
          id
          name
        }
        messages {
          field
          message
        }
      }
    }
  `, { name, groups: groupId })) as { createOnboardingFlow: { onboardingFlow: { id: string } } };

  return data.createOnboardingFlow.onboardingFlow.id;
}

export async function addFormToOnboardingFlow(
  client: HealthieClient,
  flowId: string,
  formId: string
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateOnboardingItem($flowId: String, $formId: String) {
      createOnboardingItem(input: {
        onboarding_flow_id: $flowId,
        item_type: "custom_module_form",
        item_id: $formId,
        is_skippable: false
      }) {
        onboardingItem {
          id
        }
        messages {
          field
          message
        }
      }
    }
  `, { flowId, formId })) as { createOnboardingItem: { onboardingItem: { id: string } } };

  return data.createOnboardingItem.onboardingItem.id;
}

// ============================================================
// Patients
// ============================================================

export async function createPatient(
  client: HealthieClient,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    userGroupId?: string;
  }
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateClient(
      $firstName: String,
      $lastName: String,
      $email: String,
      $phone: String,
      $dob: String,
      $gender: String,
      $groupId: String
    ) {
      createClient(input: {
        first_name: $firstName,
        last_name: $lastName,
        email: $email,
        phone_number: $phone,
        dob: $dob,
        gender: $gender,
        user_group_id: $groupId,
        dont_send_welcome: true
      }) {
        user {
          id
        }
        messages {
          field
          message
        }
      }
    }
  `, {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    dob: input.dateOfBirth,
    gender: input.gender,
    groupId: input.userGroupId,
  })) as { createClient: { user: { id: string } } };

  return data.createClient.user.id;
}

// ============================================================
// Form Completions (submit answers)
// ============================================================

export async function createFormCompletion(
  client: HealthieClient,
  patientId: string,
  formId: string,
  answers: Record<string, string | number | boolean>
): Promise<string> {
  // Convert answers to Healthie format
  const formAnswers = Object.entries(answers).map(([key, value]) => ({
    custom_module_id: key,
    answer: String(value),
    label: key,
  }));

  const data = (await gql(client, `
    mutation CreateFormAnswerGroup(
      $formId: String,
      $patientId: String,
      $formAnswers: [FormAnswerInput]
    ) {
      createFormAnswerGroup(input: {
        custom_module_form_id: $formId,
        user_id: $patientId,
        finished: true,
        form_answers: $formAnswers
      }) {
        form_answer_group {
          id
        }
        messages {
          field
          message
        }
      }
    }
  `, {
    formId,
    patientId,
    formAnswers,
  })) as { createFormAnswerGroup: { form_answer_group: { id: string } } };

  return data.createFormAnswerGroup.form_answer_group.id;
}

// ============================================================
// Push a form to a specific patient
// ============================================================

export async function requestFormCompletion(
  client: HealthieClient,
  formId: string,
  patientId: string
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateRequestedFormCompletion($formId: ID, $patientId: ID) {
      createRequestedFormCompletion(input: {
        custom_module_form_id: $formId,
        recipient_id: $patientId,
        skip_notification_email: false
      }) {
        requestedFormCompletion {
          id
        }
        messages {
          field
          message
        }
      }
    }
  `, { formId, patientId })) as { createRequestedFormCompletion: { requestedFormCompletion: { id: string } } };

  return data.createRequestedFormCompletion.requestedFormCompletion.id;
}

// ============================================================
// Appointments (for sync video visits)
// ============================================================

export async function createAppointment(
  client: HealthieClient,
  params: {
    patientId: string;
    providerId: string;
    appointmentTypeId?: string;
    notes?: string;
  }
): Promise<{ appointmentId: string }> {
  const data = (await gql(client, `
    mutation CreateAppointment(
      $patientId: String,
      $providerId: String,
      $appointmentTypeId: String,
      $notes: String
    ) {
      createAppointment(input: {
        user_id: $patientId,
        other_party_id: $providerId,
        appointment_type_id: $appointmentTypeId,
        notes: $notes,
        pm_status: "Needs_Action"
      }) {
        appointment {
          id
        }
        messages {
          field
          message
        }
      }
    }
  `, {
    patientId: params.patientId,
    providerId: params.providerId,
    appointmentTypeId: params.appointmentTypeId,
    notes: params.notes || "",
  })) as { createAppointment: { appointment: { id: string } } };

  return { appointmentId: data.createAppointment.appointment.id };
}

// ============================================================
// Provider lookup
// ============================================================

export async function getProviders(client: HealthieClient): Promise<Array<{ id: string; email: string; name: string }>> {
  const data = (await gql(client, `
    query GetProviders {
      organizationMembers(page_size: 50) {
        id
        email
        full_name
      }
    }
  `)) as { organizationMembers: Array<{ id: string; email: string; full_name: string }> };

  return data.organizationMembers.map((m) => ({
    id: m.id,
    email: m.email,
    name: m.full_name,
  }));
}

// ============================================================
// Build full intake form in Healthie from ServiceDefinition
// ============================================================

// ============================================================
// SOAP Notes (charting notes on patient chart)
// ============================================================

// SOAP note template: a CustomModuleForm with 4 textarea fields (S, O, A, P)
// Created once via /admin/setup-soap-template, IDs stored in KV as "soap-template"

export interface SoapTemplate {
  formId: string;
  subjectiveModuleId: string;
  objectiveModuleId: string;
  assessmentModuleId: string;
  planModuleId: string;
}

export async function createSoapTemplate(client: HealthieClient): Promise<SoapTemplate> {
  // Create charting form
  const data = (await gql(client, `
    mutation CreateSoapForm($name: String) {
      createCustomModuleForm(input: { name: $name, use_for_charting: true }) {
        customModuleForm { id }
        messages { field message }
      }
    }
  `, { name: "SOAP Note" })) as { createCustomModuleForm: { customModuleForm: { id: string } | null; messages: Array<{ field: string; message: string }> } };

  const form = data.createCustomModuleForm;
  if (!form.customModuleForm) {
    throw new Error(`Failed to create SOAP form: ${form.messages?.map(m => `${m.field}: ${m.message}`).join(", ")}`);
  }
  const formId = form.customModuleForm.id;

  // Create the 4 SOAP fields sequentially (Healthie rate-limits)
  const fields = [
    { label: "Subjective", sublabel: "Patient-reported symptoms and history", index: 0 },
    { label: "Objective", sublabel: "Vitals, exam findings, labs", index: 1 },
    { label: "Assessment", sublabel: "Diagnosis and clinical reasoning", index: 2 },
    { label: "Plan", sublabel: "Treatment plan, prescriptions, follow-up", index: 3 },
  ];

  const moduleIds: string[] = [];
  for (const f of fields) {
    const id = await createCustomModule(client, formId, {
      label: f.label,
      sublabel: f.sublabel,
      modType: "textarea",
      required: true,
      index: f.index,
    });
    moduleIds.push(id);
  }

  return {
    formId,
    subjectiveModuleId: moduleIds[0],
    objectiveModuleId: moduleIds[1],
    assessmentModuleId: moduleIds[2],
    planModuleId: moduleIds[3],
  };
}

export async function saveSoapNote(
  client: HealthieClient,
  template: SoapTemplate,
  params: {
    patientId: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  }
): Promise<{ noteId: string }> {
  const formAnswers = [
    { custom_module_id: template.subjectiveModuleId, answer: params.subjective, label: "Subjective" },
    { custom_module_id: template.objectiveModuleId, answer: params.objective, label: "Objective" },
    { custom_module_id: template.assessmentModuleId, answer: params.assessment, label: "Assessment" },
    { custom_module_id: template.planModuleId, answer: params.plan, label: "Plan" },
  ];

  const data = (await gql(client, `
    mutation CreateSoapNote(
      $formId: String,
      $patientId: String,
      $formAnswers: [FormAnswerInput]
    ) {
      createFormAnswerGroup(input: {
        custom_module_form_id: $formId,
        user_id: $patientId,
        finished: true,
        form_answers: $formAnswers
      }) {
        form_answer_group {
          id
        }
        messages {
          field
          message
        }
      }
    }
  `, {
    formId: template.formId,
    patientId: params.patientId,
    formAnswers,
  })) as { createFormAnswerGroup: { form_answer_group: { id: string } | null; messages: Array<{ field: string; message: string }> } };

  const result = data.createFormAnswerGroup;
  if (!result.form_answer_group) {
    const msgs = result.messages?.map(m => `${m.field}: ${m.message}`).join(", ") || "unknown error";
    throw new Error(`Failed to save SOAP note: ${msgs}`);
  }
  return { noteId: result.form_answer_group.id };
}

import { ServiceDefinition, FormStep } from "../lib/services";

function stepToModType(step: FormStep): string {
  switch (step.type) {
    case "radio": return "radio";
    case "checkbox": return "checkbox";
    case "text": return "text";
    case "textarea": return "textarea";
    case "number": return "number";
    case "date": return "date_picker";
    case "bmi": return "number"; // We'll create multiple fields for BMI
    case "file-upload": return "text"; // Healthie doesn't have file upload in forms; store URL
    case "select": return "dropdown";
    default: return "text";
  }
}

function stepToOptions(step: FormStep): string {
  if (!step.options) return "";
  return step.options.map((o) => o.label).join("\n");
}

export async function buildIntakeFormInHealthie(
  client: HealthieClient,
  service: ServiceDefinition,
  influencerName: string
): Promise<{ formId: string; moduleIds: string[] }> {
  // 1. Create the form (Healthie has a 50-char limit on form names)
  const shortName = influencerName.trim().slice(0, 18);
  const ts = Date.now().toString(36).slice(-4);
  let formName = `${shortName} ${service.id} ${ts}`;
  if (formName.length > 50) formName = formName.slice(0, 50);
  const formId = await createCustomModuleForm(client, formName);

  // 2. Build all module creation promises in parallel
  interface ModuleTask {
    index: number;
    input: CustomModuleInput;
  }

  const tasks: ModuleTask[] = [];
  let index = 0;

  for (const step of service.intakeSteps) {
    if (step.type === "bmi") {
      tasks.push({
        index: index,
        input: { label: "Weight (pounds)", sublabel: "Enter your current weight", modType: "number", required: true, index: index++ },
      });
      tasks.push({
        index: index,
        input: { label: "Height (total inches)", sublabel: "e.g., 5'10\" = 70 inches", modType: "number", required: true, index: index++ },
      });
    } else {
      tasks.push({
        index: index,
        input: {
          label: step.question,
          sublabel: step.subtitle,
          modType: stepToModType(step),
          options: stepToOptions(step),
          required: step.required !== false,
          index: index++,
        },
      });
    }
  }

  // Run sequentially — Healthie rate-limits parallel requests
  const moduleIds: string[] = [];
  for (const t of tasks) {
    const id = await createCustomModule(client, formId, t.input);
    moduleIds.push(id);
  }

  return { formId, moduleIds };
}
