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
  `, { name })) as { createCustomModuleForm: { customModuleForm: { id: string } } };

  return data.createCustomModuleForm.customModuleForm.id;
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
  })) as { createCustomModule: { customModule: { id: string } } };

  return data.createCustomModule.customModule.id;
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
// Build full intake form in Healthie from ServiceDefinition
// ============================================================

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
  // 1. Create the form
  const formName = `${influencerName} - ${service.label} Intake`;
  const formId = await createCustomModuleForm(client, formName);

  // 2. Add each step as a custom module
  const moduleIds: string[] = [];
  let index = 0;

  for (const step of service.intakeSteps) {
    if (step.type === "bmi") {
      // BMI needs multiple fields
      const weightId = await createCustomModule(client, formId, {
        label: "Weight (pounds)",
        sublabel: "Enter your current weight",
        modType: "number",
        required: true,
        index: index++,
      });
      moduleIds.push(weightId);

      const heightId = await createCustomModule(client, formId, {
        label: "Height (total inches)",
        sublabel: "e.g., 5'10\" = 70 inches",
        modType: "number",
        required: true,
        index: index++,
      });
      moduleIds.push(heightId);
    } else {
      const moduleId = await createCustomModule(client, formId, {
        label: step.question,
        sublabel: step.subtitle,
        modType: stepToModType(step),
        options: stepToOptions(step),
        required: step.required !== false,
        index: index++,
      });
      moduleIds.push(moduleId);
    }
  }

  return { formId, moduleIds };
}
