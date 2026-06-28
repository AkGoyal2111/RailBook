const prisma = require("../config/prisma");
const logger = require("../config/logger");

// ═══════════════════════════════════════════════════
//  SEARCH OPERATIONS (PostgreSQL-backed)
//  Replaces the old Elasticsearch search-service. Since admin-service
//  already owns trains, stations, routes and schedules, we can answer
//  search queries directly from its database with plain SQL/Prisma.
// ═══════════════════════════════════════════════════

const SEAT_TYPES = ['LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER'];

/**
 * Resolve a user-typed station (code OR name OR city) to a Station row.
 * Strategy: exact code match first, then case-insensitive name/city match.
 * The frontend autocomplete sends the station code, so the code path is hit
 * most of the time.
 */
const resolveStation = async (input) => {
     if (!input) return null;

     // 1. Exact code match (e.g. "NDLS")
     const byCode = await prisma.station.findUnique({
          where: { code: input.toUpperCase() },
     });
     if (byCode) return byCode;

     // 2. Fallback: partial, case-insensitive match on name or city
     return prisma.station.findFirst({
          where: {
               OR: [
                    { name: { contains: input, mode: 'insensitive' } },
                    { city: { contains: input, mode: 'insensitive' } },
               ],
          },
          orderBy: { name: 'asc' },
     });
};

const buildSeatSummary = (seats = []) => {
     const summary = { total: 0, LOWER: 0, MIDDLE: 0, UPPER: 0, SIDE_LOWER: 0, SIDE_UPPER: 0 };
     seats.forEach((s) => {
          summary.total++;
          if (summary[s.seatType] !== undefined) summary[s.seatType]++;
     });
     return summary;
};

/**
 * Search trains running between two stations on a given date.
 * Returns the same response shape the frontend already expects from the
 * old search-service.
 */
const searchTrains = async (from, to, date) => {
     const fromStation = await resolveStation(from);
     const toStation = await resolveStation(to);

     if (!fromStation) return { trains: [], count: 0, message: `Station "${from}" not found` };
     if (!toStation) return { trains: [], count: 0, message: `Station "${to}" not found` };

     // Find trains whose route contains BOTH stations.
     const candidates = await prisma.train.findMany({
          where: {
               route: {
                    AND: [
                         { routeStations: { some: { stationId: fromStation.id } } },
                         { routeStations: { some: { stationId: toStation.id } } },
                    ],
               },
          },
          include: {
               seats: { orderBy: { seatNumber: 'asc' } },
               route: {
                    include: {
                         routeStations: {
                              include: { station: true },
                              orderBy: { sequenceNumber: 'asc' },
                         },
                    },
               },
               schedules: date
                    ? { where: { departureDate: new Date(date), status: 'ACTIVE' } }
                    : false,
          },
          orderBy: { trainNumber: 'asc' },
     });

     const trains = candidates
          .map((train) => {
               const stops = train.route?.routeStations || [];
               const fromStop = stops.find((rs) => rs.stationId === fromStation.id);
               const toStop = stops.find((rs) => rs.stationId === toStation.id);

               // Train must travel from -> to in the correct direction.
               if (!fromStop || !toStop || fromStop.sequenceNumber >= toStop.sequenceNumber) {
                    return null;
               }

               // Attach the schedule for the requested date (if any).
               let scheduleInfo = null;
               if (date && train.schedules && train.schedules.length > 0) {
                    const schedule = train.schedules[0];
                    scheduleInfo = {
                         scheduleId: schedule.id,
                         departureDate: schedule.departureDate,
                         status: schedule.status,
                         available: train.totalSeats,
                         locked: 0,
                         booked: 0,
                    };
               }

               return {
                    trainId: train.id,
                    trainNumber: train.trainNumber,
                    trainName: train.trainName,
                    from: {
                         name: fromStop.station.name,
                         code: fromStop.station.code,
                         departure: fromStop.departureTime,
                         stationId: fromStop.stationId,
                         sequenceNumber: fromStop.sequenceNumber,
                    },
                    to: {
                         name: toStop.station.name,
                         code: toStop.station.code,
                         arrival: toStop.arrivalTime,
                         stationId: toStop.stationId,
                         sequenceNumber: toStop.sequenceNumber,
                    },
                    seatSummary: buildSeatSummary(train.seats),
                    schedule: scheduleInfo,
               };
          })
          .filter(Boolean);

     logger.info(`Search ${fromStation.code} -> ${toStation.code}: ${trains.length} trains`);

     return {
          from: { resolved: fromStation.name, code: fromStation.code },
          to: { resolved: toStation.name, code: toStation.code },
          date: date || 'any',
          count: trains.length,
          trains,
     };
};

/**
 * Autocomplete station names/codes as the user types.
 */
const autocompleteStation = async (prefix) => {
     const stations = await prisma.station.findMany({
          where: {
               OR: [
                    { name: { contains: prefix, mode: 'insensitive' } },
                    { code: { contains: prefix, mode: 'insensitive' } },
                    { city: { contains: prefix, mode: 'insensitive' } },
               ],
          },
          take: 10,
          orderBy: { name: 'asc' },
     });

     return stations.map((s) => ({
          name: s.name,
          code: s.code,
          stationId: s.id,
     }));
};

module.exports = { searchTrains, autocompleteStation, resolveStation, SEAT_TYPES };
