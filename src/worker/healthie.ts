const HEALTHIE_API_URL = "https://api.gethealthie.com/graphql";

interface HealthieClient {
  apiKey: string;
}

export function createHealthieClient(apiKey: string): HealthieClient {
  return { apiKey };
}

async function gql(client: HealthieClient, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(HEALTHIE_API_URL, {
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

export async function createOrganization(client: HealthieClient, name: string): Promise<string> {
  const data = (await gql(client, `
    mutation CreateOrganization($name: String!) {
      createOrganization(input: { name: $name }) {
        organization {
          id
        }
      }
    }
  `, { name })) as { createOrganization: { organization: { id: string } } };

  return data.createOrganization.organization.id;
}

export async function createPatient(
  client: HealthieClient,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    organizationId?: string;
  }
): Promise<string> {
  const data = (await gql(client, `
    mutation CreatePatient(
      $firstName: String!,
      $lastName: String!,
      $email: String!,
      $phone: String,
      $dob: String,
      $gender: String,
      $orgId: String
    ) {
      createClient(input: {
        first_name: $firstName,
        last_name: $lastName,
        email: $email,
        phone_number: $phone,
        dob: $dob,
        gender: $gender,
        organization_id: $orgId
      }) {
        user {
          id
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
    orgId: input.organizationId,
  })) as { createClient: { user: { id: string } } };

  return data.createClient.user.id;
}

export async function createFormCompletion(
  client: HealthieClient,
  patientId: string,
  formData: Record<string, string | boolean>
): Promise<string> {
  const data = (await gql(client, `
    mutation CreateFormCompletion($patientId: ID!, $formData: String!) {
      createFormAnswerGroup(input: {
        user_id: $patientId,
        json_body: $formData,
        finished: true
      }) {
        form_answer_group {
          id
        }
      }
    }
  `, {
    patientId,
    formData: JSON.stringify(formData),
  })) as { createFormAnswerGroup: { form_answer_group: { id: string } } };

  return data.createFormAnswerGroup.form_answer_group.id;
}
