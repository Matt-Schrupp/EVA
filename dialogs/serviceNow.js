var dotenv = require("dotenv");
let axios = require('axios');
dotenv.load();

let auth = `Basic ${Buffer.from(process.env.SERVICENOW_SA_ID + ':' + process.env.SERVICENOW_SA_PASSWORD).toString('base64')}`;

const config = {
    headers: {
        "Content-Type": "application/json",
        "Authorization": auth
    }
};

const createIncident = (dialogData, callerId) => {
    let route = "https://ecolabstage.service-now.com/api/now/v1/table/incident?sysparm_suppress_auto_sys_field=true";
    let incident = {
        caller_id: callerId,
        description: dialogData.description,
        short_description: dialogData.short_description,
        state: "New",
        sys_created_by: dialogData.caller,
        sys_created_on: Date.now(),
        sys_updated_by: dialogData.caller,
        sys_updated_on: Date.now()
    }
    return axios.post(route, incident, config)
};

const getIncidentByNumber = async(incidentNumber) => {
    let route = `https://ecolabstage.service-now.com/api/now/v1/table/incident?sysparm_query=number%3D${incidentNumber}`;
    return axios.get(route, config);
};


const resolveIncident = (dialogData, callerId) => {
    let route = `https://ecolabstage.service-now.com/api/now/v1/table/task/${dialogData.incidentId}?sysparm_exclude_ref_link=true`;
    let resolveIncident = {
        caller_id: callerId,
        state: "6"
    }
    return axios.put(route, resolveIncident, config)
};

const updateIncident = (dialogData, callerId) => {
    let route = `https://ecolabstage.service-now.com/api/now/v1/table/task/${dialogData.incidentId}?sysparm_exclude_ref_link=true`;
    let updateIncident = {
        caller_id: callerId,
        comments: dialogData.comments,
        sys_created_by: callerId,
        sys_created_on: Date.now()

    }

    return axios.put(route, updateIncident, config)
};

const reopenIncident = (incident) => {
    let route = "";
    return axios.post(route, incident, config)
};

const getUserRecord = (firstName, lastName) => {
    let route = `https://ecolabstage.service-now.com/api/now/v1/table/sys_user?sysparm_query=first_name%3D${firstName}%5Elast_name%3D${lastName}`;
    return axios.get(route, config);
};

const searchKnowledgeBase = (searchQuery) => {
    let route = `https://ecolabstage.service-now.com/api/now/table/kb_knowledge?sysparm_query=kb_knowledge_base=d54448954f58124034368d9f9310c72a^workflow_state=published^meta*${searchQuery}^ORtext*${searchQuery}&sysparm_exclude_reference_link=true&sysparm_fields=sys_id%2Cshort_description%2Cworkflow_state%2Ckb_knowledge_base%2Cmeta%2Ctext%2Cnumber&sysparm_limit=10`;
    return axios.get(route, config);
};

const getIncidents = (userId) => {
    let route = `https://ecolabstage.service-now.com/api/now/table/incident?sysparm_query=caller_id=${userId}^active=true^ORDERBYDESCsys_created_on&sysparm_fields=sys_id%2Csys_created_on%2Cnumber%2Copened_at%2Ccaller_id%2Cshort_description&sysparm_limit=5`;
    return axios.get(route, config);
};

module.exports = {
    createIncident: createIncident,
    resolveIncident: resolveIncident,
    updateIncident: updateIncident,
    reopenIncident: reopenIncident,
    getIncidentByNumber: getIncidentByNumber,
    getUserRecord: getUserRecord,
    getIncidents: getIncidents,
    searchKnowledgeBase: searchKnowledgeBase
};