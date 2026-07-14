let masterTimetable = [];
let uniqueStations = new Set(); 

// THIS IS YOUR DATABASE LINK
// For now, it will look for the file in the same folder. 
// Later, you will replace this with a live URL (e.g., "https://yourwebsite.com/master_timetable.csv")
const DATABASE_URL = "master_timetable.csv"; 

window.onload = function() {
    loadDatabase();
};

// Automatically fetch and parse the CSV in the background
function loadDatabase() {
    Papa.parse(DATABASE_URL, {
        download: true, // This tells PapaParse to fetch it from the web/folder
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: function(header) {
            return header.trim().toLowerCase();
        },
        complete: function(results) {
            masterTimetable = results.data;
            processLoadedData();
            console.log("Database synchronized successfully! " + masterTimetable.length + " rows loaded.");
        },
        error: function(err) {
            console.error("Failed to load database:", err);
            alert("Could not connect to the timetable database. Please check your internet connection.");
        }
    });
}

function processLoadedData() {
    uniqueStations.clear();
    masterTimetable.forEach(row => {
        if (row.station_name) {
            uniqueStations.add(row.station_name.toString().trim().toUpperCase());
        }
    });
    buildDropdowns(); 
}

// ... Keep your existing buildDropdowns(), findRoutes(), findStationBoard(), etc. below here ...

function buildDropdowns() {
    let dataList = document.getElementById('stationOptions');
    if (!dataList) {
        dataList = document.createElement('datalist');
        dataList.id = 'stationOptions';
        document.body.appendChild(dataList);
        
        document.getElementById('fromStation').setAttribute('list', 'stationOptions');
        document.getElementById('toStation').setAttribute('list', 'stationOptions');
        document.getElementById('singleStation').setAttribute('list', 'stationOptions');
    }
    
    dataList.innerHTML = '';
    uniqueStations.forEach(station => {
        let option = document.createElement('option');
        option.value = station;
        dataList.appendChild(option);
    });
}

function getTrainTier(trainNo) {
    const num = parseInt(trainNo, 10);
    if (num >= 701 && num <= 828) return "Intercity";
    return "Local";
}

function swapStations() {
    let fromInput = document.getElementById("fromStation");
    let toInput = document.getElementById("toStation");
    let temp = fromInput.value;
    fromInput.value = toInput.value;
    toInput.value = temp;
}

function hideAllResults() {
    document.getElementById("intercityResults").style.display = "none";
    document.getElementById("localResults").style.display = "none";
    document.getElementById("connectionResults").style.display = "none";
    document.getElementById("generalResults").style.display = "none";
}

function timeToMins(timeStr) {
    if (!timeStr) return 0;
    let parts = String(timeStr).split(':');
    if (parts.length < 2) return 0;
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function calculateDuration(depTime, arrTime) {
    if (!depTime || !arrTime) return 999999; 
    let depMins = timeToMins(depTime);
    let arrMins = timeToMins(arrTime);
    if (arrMins < depMins) arrMins += 24 * 60; // Crosses midnight
    return arrMins - depMins;
}

function formatDuration(totalMins) {
    if (totalMins === 999999) return "Unknown";
    let hours = Math.floor(totalMins / 60);
    let mins = totalMins % 60;
    return `${hours}h ${mins}m`;
}

// 4. Find Route 
function findRoutes() {
    if (masterTimetable.length === 0) return alert("Please load the CSV file first.");

    const fromStation = document.getElementById("fromStation").value.trim().toUpperCase();
    const toStation = document.getElementById("toStation").value.trim().toUpperCase();
    const sortPreference = document.getElementById("sortBy").value;

    if (!fromStation || !toStation) return alert("Please enter both stations.");

    hideAllResults();
    
    const intercityList = document.getElementById("intercityList");
    const localList = document.getElementById("localList");
    const connectionList = document.getElementById("connectionList");
    intercityList.innerHTML = "";
    localList.innerHTML = "";
    connectionList.innerHTML = "";
    
    let validRoutes = [];
    let connectingRoutes = [];
    let trainsMap = {};

    masterTimetable.forEach(row => {
        if (!row.train_no) return; 
        let tNo = String(row.train_no).trim();
        if (!trainsMap[tNo]) trainsMap[tNo] = [];
        trainsMap[tNo].push(row);
    });

    // A. FIND DIRECT ROUTES
    for (let tNo in trainsMap) {
        let stops = trainsMap[tNo];
        let startStop = stops.find(s => s.station_name && s.station_name.toString().trim().toUpperCase() === fromStation);
        let endStop = stops.find(s => s.station_name && s.station_name.toString().trim().toUpperCase() === toStation);

        if (startStop && endStop) {
            let startOrder = parseInt(startStop.station_order);
            let endOrder = parseInt(endStop.station_order);

            if (!isNaN(startOrder) && !isNaN(endOrder) && (startOrder < endOrder)) {
                let durationMins = calculateDuration(startStop.departure_time, endStop.arrival_time);
                validRoutes.push({
                    trainNo: tNo,
                    trainName: startStop.train_name || "Unknown",
                    depTime: startStop.departure_time || "N/A",
                    arrTime: endStop.arrival_time || "N/A",
                    offDay: startStop.off_day || "None",
                    tier: getTrainTier(tNo),
                    durationMins: durationMins,
                    durationText: formatDuration(durationMins)
                });
            }
        }
    }

    // B. FIND CONNECTING ROUTES 
    // Create a list of direct train numbers so we can ban them from connections
    let directTrainNumbers = new Set(validRoutes.map(route => route.trainNo));

    let fromLegs = [];
    let toLegs = [];

    for (let tNo in trainsMap) {
        // LOGIC FIX: If this train is already a direct route, skip it entirely!
        if (directTrainNumbers.has(tNo)) continue;

        let stops = trainsMap[tNo];
        let startMatch = stops.find(s => s.station_name && s.station_name.toString().trim().toUpperCase() === fromStation);
        if (startMatch) fromLegs.push({ tNo: tNo, stops: stops, startIndex: stops.indexOf(startMatch) });

        let endMatch = stops.find(s => s.station_name && s.station_name.toString().trim().toUpperCase() === toStation);
        if (endMatch) toLegs.push({ tNo: tNo, stops: stops, endIndex: stops.indexOf(endMatch) });
    }

    for (let leg1 of fromLegs) {
        for (let leg2 of toLegs) {
            if (leg1.tNo === leg2.tNo) continue; 

            let validTransfers1 = leg1.stops.slice(leg1.startIndex + 1);
            let validTransfers2 = leg2.stops.slice(0, leg2.endIndex);

            for (let stop1 of validTransfers1) {
                let transferStation = stop1.station_name.toUpperCase();
                let stop2 = validTransfers2.find(s => s.station_name.toUpperCase() === transferStation);

                if (stop2) {
                    let arrTimeAtTransfer = stop1.arrival_time || stop1.departure_time;
                    let depTimeAtTransfer = stop2.departure_time || stop2.arrival_time;
                    
                    if (arrTimeAtTransfer && depTimeAtTransfer) {
                        let arrMins = timeToMins(arrTimeAtTransfer);
                        let depMins = timeToMins(depTimeAtTransfer);
                        
                        if (arrMins <= depMins) {
                            let leg1Dur = calculateDuration(leg1.stops[leg1.startIndex].departure_time, arrTimeAtTransfer);
                            let layoverDur = calculateDuration(arrTimeAtTransfer, depTimeAtTransfer);
                            let leg2Dur = calculateDuration(depTimeAtTransfer, leg2.stops[leg2.endIndex].arrival_time);
                            let totalDur = leg1Dur + layoverDur + leg2Dur;
                            
                            connectingRoutes.push({
                                leg1No: leg1.tNo,
                                leg1Name: leg1.stops[0].train_name,
                                leg2No: leg2.tNo,
                                leg2Name: leg2.stops[0].train_name,
                                transferStation: transferStation,
                                depTime: leg1.stops[leg1.startIndex].departure_time,
                                transferArr: arrTimeAtTransfer,
                                transferDep: depTimeAtTransfer,
                                arrTime: leg2.stops[leg2.endIndex].arrival_time,
                                durationMins: totalDur,
                                durationText: formatDuration(totalDur)
                            });
                            break; 
                        }
                    }
                }
            }
        }
    }

    // Sort Direct Routes
    validRoutes.sort((a, b) => {
        if (sortPreference === "duration") return a.durationMins - b.durationMins;
        return String(a.depTime).padStart(5, '0').localeCompare(String(b.depTime).padStart(5, '0'));
    });
    
    // Sort Connections
    connectingRoutes.sort((a, b) => {
        if (sortPreference === "duration") return a.durationMins - b.durationMins;
        return String(a.depTime).padStart(5, '0').localeCompare(String(b.depTime).padStart(5, '0'));
    });

    // Display Direct Routes
    let intercityCount = 0, localCount = 0;
    validRoutes.forEach(route => {
        let cardHtml = `
            <div class="train-card">
                <b>${route.trainName} (Train: ${route.trainNo})</b> <span class="duration-badge">⏱ ${route.durationText}</span><br>
                Departs: <b>${route.depTime}</b> | Arrives: <b>${route.arrTime}</b><br>
                <span class="off-day">Off-day: ${route.offDay}</span>
            </div>`;
        if (route.tier === "Intercity") { intercityList.innerHTML += cardHtml; intercityCount++; } 
        else { localList.innerHTML += cardHtml; localCount++; }
    });

    if (intercityCount > 0) document.getElementById("intercityResults").style.display = "block";
    if (localCount > 0) document.getElementById("localResults").style.display = "block";

    if (intercityCount === 0 && localCount === 0) {
        intercityList.innerHTML = "<p>No direct trains found for this route.</p>";
        document.getElementById("intercityResults").style.display = "block";
    }

    // Display Connecting Routes
    if (connectingRoutes.length > 0) {
        connectingRoutes.forEach(conn => {
            connectionList.innerHTML += `
                <div class="train-card">
                    <b>Departure: ${conn.depTime}</b> <span class="duration-badge">Total Trip: ⏱ ${conn.durationText}</span><br>
                    Leg 1: <b>${conn.leg1Name} (${conn.leg1No})</b>
                    
                    <div class="transfer-node">
                        🔄 <b>Transfer at ${conn.transferStation}</b><br>
                        Arrive: ${conn.transferArr} | Next Train Departs: ${conn.transferDep}
                    </div>
                    
                    Leg 2: <b>${conn.leg2Name} (${conn.leg2No})</b><br>
                    <b>Final Arrival: ${conn.arrTime}</b>
                </div>
            `;
        });
        document.getElementById("connectionResults").style.display = "block";
    }
}

// 5. Find Station Board
function findStationBoard() {
    const station = document.getElementById("singleStation").value.trim().toUpperCase();
    if (!station) return alert("Enter a station name.");
    
    hideAllResults();
    
    let trainsAtStation = masterTimetable.filter(row => row.station_name && row.station_name.toString().trim().toUpperCase() === station);
    if (trainsAtStation.length === 0) return alert("No trains found for this station.");
    
    trainsAtStation.sort((a, b) => {
        let timeA = String(a.departure_time || '23:59').padStart(5, '0');
        let timeB = String(b.departure_time || '23:59').padStart(5, '0');
        return timeA.localeCompare(timeB);
    });
    
    let html = trainsAtStation.map(t => `
        <div class="train-card">
            <b>${t.train_name || 'Unknown'} (${t.train_no})</b> - <small>${getTrainTier(t.train_no)}</small><br>
            Route: <b>${t.origin_station || 'N/A'}</b> ➔ <b>${t.destination_station || 'N/A'}</b><br>
            Arrives: <b>${t.arrival_time || '--:--'}</b> | Departs: <b>${t.departure_time || '--:--'}</b><br>
            <span class="off-day">Off-day: ${t.off_day || 'None'}</span>
        </div>
    `).join("");

    document.getElementById("generalResultsTitle").innerText = `Live Board: ${station}`;
    document.getElementById("generalResultsList").innerHTML = html;
    document.getElementById("generalResults").style.display = "block";
}

// 6. Find Full Train Route
function findTrainDetails() {
    const query = document.getElementById("trainSearch").value.trim().toUpperCase();
    if (!query) return alert("Enter a train name or number.");
    
    hideAllResults();
    
    let trainStops = masterTimetable.filter(row => 
        (row.train_no && String(row.train_no).trim().toUpperCase() === query) || 
        (row.train_name && String(row.train_name).trim().toUpperCase() === query)
    );
    
    if (trainStops.length === 0) return alert("Train not found.");
    
    trainStops.sort((a, b) => parseInt(a.station_order) - parseInt(b.station_order));
    
    let trainInfo = trainStops[0];
    let html = trainStops.map(t => `
        <div class="train-card">
            Stop ${t.station_order}: <b>${t.station_name}</b><br>
            Arrives: ${t.arrival_time || '--:--'} | Departs: ${t.departure_time || '--:--'}
        </div>
    `).join("");

    document.getElementById("generalResultsTitle").innerText = `Route: ${trainInfo.train_name} (${trainInfo.train_no}) | Off-day: ${trainInfo.off_day || 'None'}`;
    document.getElementById("generalResultsList").innerHTML = html;
    document.getElementById("generalResults").style.display = "block";
}
