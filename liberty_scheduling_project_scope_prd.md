# Project: Monthly Recurring Pest Control Service Scheduling & Optimization System

## 1. Project Goal & Objective

To develop a system that generates a highly optimized, stable, and recurring monthly schedule for approximately 5500+ pest control services across the New York City metro area (including denser boroughs and more spread-out areas like parts of NJ/LI). The primary objective is to **minimize the total number of technicians required** to complete all scheduled services for a representative month. This optimized monthly schedule will then serve as a fixed template for subsequent months, ensuring predictability and efficiency while adhering to customer requirements and operational constraints.

## 2. System Inputs

The system will require the following data inputs:

*   **Customer Service Data:**
    *   List of all recurring service customers (~5500+).
    *   Unique Customer/Service Identifier.
    *   Customer Location: Latitude/Longitude coordinates. Zip code also available for context/zoning.
    *   Service Frequency: Defined categories (e.g., `'MONTHLY'`, `'BIWEEKLY'`, `'WEEKLY'`).
    *   Service Day Availability: A 7-digit binary string (representing Sunday to Saturday) indicating permissible days for scheduling (e.g., `'0111110'` allows Monday-Friday).
    *   Service Time Window: A specific, hard time range during which service *must start*.
    *   Default Service Duration: Standard time allocated for the service itself.
*   **Technician Data:**
    *   List of available technicians (~80).
    *   Unique Technician Identifier.
    *   Technician Start Location (Implicitly their home - relevant for context but not work time calculation).
*   **Operational Parameters (Configurable):**
    *   Maximum Daily Technician Work Time: Total time including service durations and *inter-service travel time* (e.g., `8 hours`).
    *   Maximum Daily Technician Travel Time: A subset of the work time, specifically capping total *inter-service travel time* (e.g., `3 hours` default).
    *   Maximum Inter-Service Travel Threshold: A limit on travel time or distance allowed between two consecutive services for the *same technician* on the *same day*. This threshold should ideally be adaptable based on geographic density (e.g., shorter limits in dense NYC boroughs, potentially longer limits in suburban NJ/LI).
*   **External Services:**
    *   Access to a time-based Travel Time Estimation API (e.g., Google Maps, Mapbox) for calculating realistic travel times between service locations based on road networks and typical traffic conditions. API keys and associated costs are assumed to be managed.

## 3. Core System Functionality

*   **Schedule Generation Scope:** The system will generate a complete, optimized schedule for one representative calendar month.
*   **Service Assignment:** Assign each required service instance within the month to a specific technician.
*   **Day & Week Selection (for Multi-Frequency):**
    *   For `MONTHLY` services, select the optimal day within the month based on availability and route efficiency.
    *   For `BIWEEKLY`/`WEEKLY` services, select the optimal starting week and day-of-the-week (respecting availability). Once a day-of-the-week is chosen (e.g., Tuesday), all subsequent services for that customer *within that month* must occur on the same day-of-the-week (e.g., all Tuesdays). The system can choose between starting in week 1/3 or week 2/4 (for `BIWEEKLY`) based on optimal clustering.
*   **Route Sequencing:** Determine the optimal sequence of services for each technician on each scheduled workday.
*   **Travel Time Integration:** Calculate travel time between consecutive services using the designated API and incorporate this into the schedule and work time calculations.
*   **Constraint Adherence:** Ensure all generated schedules rigorously adhere to *all* defined constraints (see Section 4).
*   **Optimization Engine:** Employ optimization algorithms or heuristics to find a near-optimal solution that primarily minimizes the number of technicians used and secondarily minimizes total travel time/distance, subject to the constraints. The system may require multiple passes or iterations to refine the schedule.

## 4. Key Constraints & Rules

The generated schedule must strictly adhere to the following:

*   **Day Availability:** Services must only be scheduled on days permitted by the customer's 7-digit availability string (Su-Sa). All permitted days are initially considered equal candidates.
*   **Time Window:** Service must *start* within the customer's specified hard time window. Completion time is flexible based on duration.
*   **Technician Continuity:**
    *   *Within Month:* If a customer receives service multiple times per month (Weekly/Bi-Weekly), the *same assigned technician* must perform all services for that customer within that calendar month.
    *   *Across Months:* The generated one-month schedule acts as a static template. The same technician assignments and day/week patterns will repeat in subsequent months automatically. The system logic focuses solely on optimizing *one representative month*.
*   **Service Duration:** The full default service duration must be allocated in the technician's schedule.
*   **Travel Time:** Calculated travel time between consecutive jobs must be added to the technician's schedule.
*   **Technician Daily Capacity:** The sum of service durations and *inter-service travel times* for a technician on any given day must not exceed the configured maximum daily work time (e.g., `8 hours`). Travel *to* the first job and *home from* the last job is excluded from this calculation.
*   **Technician Daily Travel Limit:** The total *inter-service travel time* for a technician on any given day must not exceed the configured maximum (e.g., `3 hours`).
*   **Inter-Service Travel Threshold:** Travel time/distance between two consecutive services must not exceed the configured threshold. The system should aim to support geographically sensitive thresholds (lower in dense areas, higher in sparse areas).
*   **Technician Assignment:** No pre-defined territories; the system has the freedom to assign technicians purely based on optimization potential.

## 5. Optimization Objectives

*   **Primary:** Minimize the total count of unique technicians required to fulfill all service obligations for the representative month.
*   **Secondary:** Minimize the total aggregated travel time/distance across all scheduled routes for all technicians, within the bounds of the primary objective and constraints.

## 6. System Outputs

*   **Optimized Monthly Schedule Template:** A detailed, technician-centric schedule for the representative month. This includes:
    *   For each required technician:
        *   A list of assigned workdays within the month.
        *   For each workday: A sequenced list of assigned services including Customer ID, Location (for context), Scheduled Start Time, Service Duration, and Estimated Travel Time from the previous service.
*   **Output Format:** A batch output file (e.g., CSV, Excel, JSON) suitable for manual input into the existing operational software or potentially for future integration via API.
*   **(Optional but Recommended):** Summary report including total technicians used, total services scheduled, total estimated travel time, average technician utilization percentage, and identification of any services that could not be scheduled (if any, indicating constraint conflicts or insufficient resources).

## 7. Assumptions & Exclusions

*   **Uniform Technician Skill:** All technicians are considered capable of performing all service types.
*   **No Specific Technician Requests:** Customer preferences for specific technicians are not considered in this optimization phase.
*   **Static Schedule:** The system generates a fixed, recurring template. It does not perform real-time adjustments, dynamic rescheduling, or handle exceptions (e.g., sick days, emergency calls). These are handled manually outside the system.
*   **Data Accuracy:** Accuracy of input data (locations, durations, availability, time windows) is assumed. Inaccurate data will lead to suboptimal or infeasible schedules.
*   **One-Time Optimization:** The primary use case is a one-time, major rescheduling effort to establish a new, efficient baseline template. Manual adjustments will maintain it going forward.

## 8. Operational Context

This system functions as an offline, batch-processing tool. It is run as needed (primarily once) to generate the foundational schedule template. Its output serves as the basis for updating the schedules within the main operational software used for daily dispatch and management.