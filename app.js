let masterTimetable = [];
let uniqueStations = new Set(); 
let stationGraph = {}; // NEW: The Advanced Pathfinder Graph

// THIS IS YOUR DATABASE LINK
const DATABASE_URL = "master_timetable.csv"; 

window.onload = function() {
    loadDatabase();
};

function loadDatabase() {
    Papa.parse(DATABASE_URL, {
        download: true, 
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
            alert("Could not connect to the timetable database.");
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
    buildPathfinderGraph(); // Build the graph map in the background
}

// ==========================================
// 📍 THE NEW PATHFINDER GRAPH ENGINE
// This maps every possible station-to-station jump so multi-leg searches are instant.
// ==========================================
function buildPathfinderGraph() {
    stationGraph = {};
    let trainsMap = {};
    
    masterTimetable.forEach(row => {
        if (!row.train_no || !row.station_name) return; 
        let tNo = String(row.train_no).trim();
        if (!trainsMap[tNo]) trainsMap[tNo] = [];
        trainsMap[tNo].push(row);
    });

    for (let tNo in trainsMap) {
        let stops = trainsMap[tNo];
        stops.sort((a, b) => parseInt(a.station_order) - parseInt(b.station_order));
        
        let tName = stops[0].train_name || "Unknown";
        let rootName = tName.split(" ")[0].toUpperCase();
        
        for (let i = 0; i < stops.length; i++) {
            let s1 = stops[i].station_name.toString().trim().toUpperCase();
            if (!stationGraph[s1]) stationGraph[s1] = [];
            
            for (let j = i + 1; j < stops.length; j++) {
                let s2 = stops[j].station_name.toString().trim().toUpperCase();
                let depTime = stops[i].departure_time || stops[i].arrival_time;
                let arrTime = stops[j].arrival_time || stops[j].departure_time;
                if (!depTime || !arrTime) continue;
                
                stationGraph[s1].push({
                    toStation: s2,
                    trainNo: tNo,
                    trainName: rootName, 
                    fullName: tName,
                    depTime: depTime,
                    arrTime: arrTime,
                    legDuration: calculateDuration(depTime, arrTime),
                    offDay: stops[0].off_day || "None"
                });
            }
        }
    }
}

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
    if (arrMins < depMins) arrMins += 24 * 60; 
    return arrMins - depMins;
}

function formatDuration(totalMins) {
    if (totalMins === 999999) return "Unknown";
    let hours = Math.floor(totalMins / 60);
    let mins = totalMins % 60;
    return `${hours}h ${mins}m`;
}

// ==========================================
// 📍 THE DYNAMIC CONNECTION SEARCHER (BFS)
// ==========================================
function findGraphConnections(fromStation, toStation, maxLegs, bannedRoots) {
    let validPaths = [];
    let queue = [];

    let startEdges = stationGraph[fromStation] || [];
    for (let edge of startEdges) {
        if (!bannedRoots.has(edge.trainName)) {
            queue.push([{
                fromStation: fromStation,
                toStation: edge.toStation,
                trainNo: edge.trainNo,
                fullName: edge.fullName,
                trainName: edge.trainName,
                depTime: edge.depTime,
                arrTime: edge.arrTime,
                legDuration: edge.legDuration,
                transferArr: null, 
                layoverMins: 0
            }]); 
        }
    }

    while (queue.length > 0) {
        let path = queue.shift();
        let lastEdge = path[path.length - 1];
        let currentLegCount = path.length;

        if (lastEdge.toStation === toStation) {
            if (currentLegCount <= maxLegs) validPaths.push(path);
            continue;
        }

        if (currentLegCount < maxLegs) {
            let nextEdges = stationGraph[lastEdge.toStation] || [];
            for (let nextEdge of nextEdges) {
                
                let usedTrains = new Set(path.map(p => p.trainName));
                if (usedTrains.has(nextEdge.trainName) || bannedRoots.has(nextEdge.trainName)) continue;
                
                let visitedStations = new Set(path.map(p => p.toStation));
                visitedStations.add(fromStation);
                if (visitedStations.has(nextEdge.toStation)) continue;

                let arrMins = timeToMins(lastEdge.arrTime);
                let depMins = timeToMins(nextEdge.depTime);
                let layoverMins = depMins - arrMins;
                if (layoverMins < 0) layoverMins += 24 * 60; // Midnight safety

                if (layoverMins >= 0 && layoverMins <= 720) {
                    let newLeg = {
                        fromStation: lastEdge.toStation,
                        toStation: nextEdge.toStation,
                        trainNo: nextEdge.trainNo,
                        fullName: nextEdge.fullName,
                        trainName: nextEdge.trainName,
                        depTime: nextEdge.depTime,
                        arrTime: nextEdge.arrTime,
                        legDuration: nextEdge.legDuration,
                        transferArr: lastEdge.arrTime, 
                        layoverMins: layoverMins
                    };
                    queue.push([...path, newLeg]);
                }
            }
        }
    }
    return validPaths;
}

// Helper to draw the complex multi-leg HTML cards
function renderDynamicPathCard(path) {
    let firstLeg = path[0];
    let lastLeg = path[path.length - 1];
    
    let totalDurMins = 0;
    path.forEach(leg => totalDurMins += leg.legDuration + leg.layoverMins);
    
    let html = `
        <div class="train-card">
            <b>Departure: ${firstLeg.depTime}</b> <span class="duration-badge">Total Trip: ⏱ ${formatDuration(totalDurMins)}</span><br>
            <span class="off-day">Legs: ${path.length}</span><br>
            Leg 1: <b>${firstLeg.fullName} (${firstLeg.trainNo})</b><br>
    `;
    
    for (let i = 1; i < path.length; i++) {
        let currLeg = path[i];
        html += `
            <div class="transfer-node">
                🔄 <b>Transfer at ${currLeg.fromStation}</b> (Wait: ${formatDuration(currLeg.layoverMins)})<br>
                Arrive: ${currLeg.transferArr} | Next Train Departs: ${currLeg.depTime}
            </div>
            Leg ${i+1}: <b>${currLeg.fullName} (${currLeg.trainNo})</b><br>
        `;
    }
    
    html += `<b>Final Arrival: ${lastLeg.arrTime}</b></div>`;
    return html;
}

// 4. MAIN FIND ROUTES FUNCTION
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

    // Sort & Render Direct Routes
    validRoutes.sort((a, b) => {
        if (sortPreference === "duration") return a.durationMins - b.durationMins;
        return String(a.depTime).padStart(5, '0').localeCompare(String(b.depTime).padStart(5, '0'));
    });

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

    // B. DYNAMIC FALLBACK ROUTING SYSTEM
    let directTrainRoots = new Set(validRoutes.map(route => route.trainName.split(" ")[0].toUpperCase()));
    
    // We pass '4' as max depth to gather all potential options quickly
    let allConnections = findGraphConnections(fromStation, toStation, 4, directTrainRoots);
    
    let doubleRoutes = allConnections.filter(p => p.length === 2);
    let tripleRoutes = allConnections.filter(p => p.length === 3);
    let tetraRoutes  = allConnections.filter(p => p.length === 4);

    let hasDirect = validRoutes.length > 0;
    let hasDouble = doubleRoutes.length > 0;
    
    let routesToShow = [];

    // YOUR EXACT SCENARIOS:
    if (hasDirect) {
        // Scenario A: Direct train found. Only show 2-leg connections. Ignore 3 and 4 leg.
        routesToShow = doubleRoutes;
    } else if (hasDouble) {
        // Scenario B: No Direct, but Double found. Show 2-leg and 3-leg. Ignore 4 leg.
        routesToShow = [...doubleRoutes, ...tripleRoutes];
    } else {
        // Scenario C: No Direct, No Double. Last resort: Show 3-leg and 4-leg.
        routesToShow = [...tripleRoutes, ...tetraRoutes];
    }

    // Sort the final chosen connections
    routesToShow.sort((a, b) => {
        let durA = a.reduce((sum, leg) => sum + leg.legDuration + leg.layoverMins, 0);
        let durB = b.reduce((sum, leg) => sum + leg.legDuration + leg.layoverMins, 0);
        if (sortPreference === "duration") return durA - durB;
        return String(a[0].depTime).padStart(5, '0').localeCompare(String(b[0].depTime).padStart(5, '0'));
    });

    // Render chosen connections to screen
    if (routesToShow.length > 0) {
        routesToShow.forEach(path => {
            connectionList.innerHTML += renderDynamicPathCard(path);
        });
        document.getElementById("connectionResults").style.display = "block";
    } else if (!hasDirect) {
        connectionList.innerHTML = "<p>No routes found (Direct or Connecting) for this journey.</p>";
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
