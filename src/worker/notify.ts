/**
 * Notification orchestrator for My Orbit Health.
 *
 * AUDIT CHANGES v1.1.0 (2026-04-05):
 *   - blocked / in_person_required: Patient now receives a notification explaining
 *     the situation and next steps. Previously only the doctor was notified, leaving
 *     patients with zero communication after submitting intake.
 *   - async: Patient now receives an intake acknowledgment email. Previously patients
 *     received nothing until the doctor acted.
 *   - Routing failure fail-safe changed from "async" to "blocked". Defaulting to async
 *     on routing error was a compliance risk — a TX or WA testosterone patient with a
 *     routing error would silently receive async treatment when sync is legally required.
 *     Now fails toward caution: doctor is alerted, patient is notified, human reviews.
 *   - Healthie appointment failure now surfaces in doctor email body so the doctor
 *     knows the Healthie step did not complete and can schedule manually.
 *   - daysSinceLastVisit passed through to router for TX 90-day lapse enforcement.
 *
 * Called after patient intake submission. Uses routing rules to determine
 * visit type, then:
 *   - async            → doctor review email + patient acknowledgment email
 *   - sync             → doctor email + Healthie appointment + patient scheduling email
 *   - blocked /
 *     in_person_required → doctor alert email + patient explanation email
 *   - routing error    → doctor alert email + patient explanation email (fail closed)
 */

import { Env } from "../lib/types";
import { routePatient, RoutingResult } from "../lib/router";
import { DosingResult } from "../lib/dosing";
import { getPartner } from "../lib/kv";
import { getServiceById } from "../lib/services";
import {
  sendEmail,
  buildAsyncReviewEmail,
  buildAsyncPatientAckEmail,
  buildSyncVisitEmail,
  buildBlockedVisitEmail,
  buildPatientBlockedEmail,
  buildPatientSyncEmail,
} from "./email";
import { createHealthieClient, createAppointment } from "./healthie";

export interface NotifyParams {
  partnerSlug: string;
  serviceType: string;
  patientName: string;
  patientEmail: string;
  patientState: string;
  patientId?: string;             // Healthie patient ID
  medplumPatientId?: string;      // Medplum patient ID
  isFirstVisit: boolean;
  daysSinceLastVisit?: number;    // Used for TX 90-day lapse enforcement
  dosingResult?: DosingResult;    // From dosing engine
}

export interface NotifyResult {
  visitType: string;
  doctorNotified: boolean;
  patientNotified: boolean;
  appointmentCreated: boolean;
  appointmentError?: string;      // Set if Healthie call failed — surfaced to doctor
  routingError?: boolean;         // True if routing failed and fallback was used
  error?: string;
}

export async function notifyOnIntake(
  env: Env,
  params: NotifyParams
): Promise<NotifyResult> {
  const result: NotifyResult = {
    visitType: "blocked",         // Default to blocked — overwritten on success
    doctorNotified: false,
    patientNotified: false,
    appointmentCreated: false,
  };

  // 1. Get partner config
  const partner = await getPartner(env.PARTNERS, params.partnerSlug);
  if (!partner) {
    result.error = `Partner not found: ${params.partnerSlug}`;
    return result;
  }

  // 2. Get service label for emails
  const service = getServiceById(params.serviceType);
  const serviceName = service?.label || params.serviceType;

  // 3. Route patient
  let routing: RoutingResult;
  let routingFailed = false;

  try {
    routing = routePatient(
      params.patientState,
      params.serviceType,
      params.isFirstVisit,
      params.daysSinceLastVisit,
    );
  } catch (err) {
    // CHANGED: Fail closed — blocked/review_required, not async.
    // Defaulting to async on routing error is a compliance risk for sync-required states.
    console.error("Routing failed — defaulting to blocked for human review:", err);
    routing = {
      visitType: "blocked",
      schedule: "unknown",
      constraints: ["routing_error_manual_review_required"],
      routingNote: `Routing failed: ${String(err)}`,
      licenseNote: "",
      category: "UNKNOWN",
      state: params.patientState,
      serviceId: params.serviceType,
      lapseOverride: false,
    };
    routingFailed = true;
    result.routingError = true;
  }

  result.visitType = routing.visitType;

  const doctorEmail = env.ADMIN_EMAIL;

  try {
    switch (routing.visitType) {
      case "async": {
        // Doctor: review ready
        await sendEmail(env.RESEND_API_KEY, {
          to: doctorEmail,
          subject: `New Async Review: ${params.patientName} — ${serviceName} (${params.patientState})`,
          html: buildAsyncReviewEmail({
            patientName: params.patientName,
            patientState: params.patientState,
            serviceName,
            partnerName: partner.businessName,
            partnerSlug: params.partnerSlug,
            healthiePatientId: params.patientId,
            medplumPatientId: params.medplumPatientId,
            dosingResult: params.dosingResult,
          }),
        });
        result.doctorNotified = true;

        // ADDED: Patient acknowledgment — previously patients got nothing for async.
        // Reduces support inquiries and meets basic patient communication expectations.
        try {
          await sendEmail(env.RESEND_API_KEY, {
            to: params.patientEmail,
            subject: `We received your ${serviceName} intake — what happens next`,
            html: buildAsyncPatientAckEmail({
              patientName: params.patientName,
              serviceName,
              partnerName: partner.businessName,
            }),
          });
          result.patientNotified = true;
        } catch (err) {
          console.error("Async patient ack email failed:", err);
        }
        break;
      }

      case "sync": {
        // Track Healthie outcome before sending doctor email so we can include status.
        let healthieError: string | undefined;

        if (params.patientId) {
          try {
            const healthie = createHealthieClient(env.HEALTHIE_API_KEY);
            await createAppointment(healthie, {
              patientId: params.patientId,
              providerId: env.DOCTOR_HEALTHIE_ID,
              notes: [
                `Sync video visit required — ${params.patientState} state compliance for ${serviceName}.`,
                `Constraints: ${routing.constraints.join(", ")}`,
                routing.lapseOverride
                  ? `Note: Follow-up rerouted to sync — days since last visit (${params.daysSinceLastVisit}) exceeded threshold.`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            });
            result.appointmentCreated = true;
          } catch (err) {
            healthieError = String(err);
            result.appointmentError = healthieError;
            console.error("Healthie appointment creation failed:", err);
          }
        }

        // Doctor email — includes Healthie failure notice if applicable.
        await sendEmail(env.RESEND_API_KEY, {
          to: doctorEmail,
          subject: `Video Visit Needed: ${params.patientName} — ${serviceName} (${params.patientState})`,
          html: buildSyncVisitEmail({
            patientName: params.patientName,
            patientEmail: params.patientEmail,
            patientState: params.patientState,
            serviceName,
            partnerName: partner.businessName,
            constraints: routing.constraints,
            healthiePatientId: params.patientId,
            medplumPatientId: params.medplumPatientId,
            appointmentCreated: result.appointmentCreated,
            appointmentError: healthieError,
            dosingResult: params.dosingResult,
          }),
        });
        result.doctorNotified = true;

        // Patient scheduling email
        try {
          await sendEmail(env.RESEND_API_KEY, {
            to: params.patientEmail,
            subject: `Your ${serviceName} Video Visit — Next Steps`,
            html: buildPatientSyncEmail({
              patientName: params.patientName,
              serviceName,
              partnerName: partner.businessName,
            }),
          });
          result.patientNotified = true;
        } catch (err) {
          console.error("Patient sync email failed:", err);
        }
        break;
      }

      case "in_person_required":
      case "blocked": {
        // Doctor alert
        await sendEmail(env.RESEND_API_KEY, {
          to: doctorEmail,
          subject: `Action Required: ${params.patientName} — ${serviceName} (${params.patientState})`,
          html: buildBlockedVisitEmail({
            patientName: params.patientName,
            patientEmail: params.patientEmail,
            patientState: params.patientState,
            serviceName,
            partnerName: partner.businessName,
            visitType: routing.visitType,
            constraints: routing.constraints,
            medplumPatientId: params.medplumPatientId,
            routingFailed,
          }),
        });
        result.doctorNotified = true;

        // ADDED: Patient notification — previously patients got zero communication.
        try {
          await sendEmail(env.RESEND_API_KEY, {
            to: params.patientEmail,
            subject: `Important: Your ${serviceName} Request — Action Required`,
            html: buildPatientBlockedEmail({
              patientName: params.patientName,
              serviceName,
              visitType: routing.visitType,
              patientState: params.patientState,
              partnerName: partner.businessName,
              routingFailed,
            }),
          });
          result.patientNotified = true;
        } catch (err) {
          console.error("Patient blocked email failed:", err);
        }
        break;
      }

      default: {
        // Guard against any future non-standard visit_type values.
        console.error(`Unhandled visitType: '${routing.visitType}' for ${params.patientState} / ${params.serviceType}`);
        await sendEmail(env.RESEND_API_KEY, {
          to: doctorEmail,
          subject: `Routing Error: Unknown visit type for ${params.patientName} (${params.patientState})`,
          html: buildBlockedVisitEmail({
            patientName: params.patientName,
            patientEmail: params.patientEmail,
            patientState: params.patientState,
            serviceName,
            partnerName: partner.businessName,
            visitType: routing.visitType,
            constraints: routing.constraints,
            medplumPatientId: params.medplumPatientId,
            routingFailed: true,
          }),
        });
        result.doctorNotified = true;
        result.error = `Unhandled visitType: '${routing.visitType}'`;
        break;
      }
    }
  } catch (err) {
    console.error("Notification failed:", err);
    result.error = String(err);
  }

  return result;
}
