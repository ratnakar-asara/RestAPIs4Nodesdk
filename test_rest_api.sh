#!/bin/bash -x

# This causes this script to exit with error if any command within this script fails with error.
# https://stackoverflow.com/questions/1378274/in-a-bash-script-how-can-i-exit-the-entire-script-if-a-certain-condition-occurs
set -e

TEMP_DIR=test_rest_api_temporary_files
ACTUAL_OUTPUT=${TEMP_DIR}/actual
EXPECTED_OUTPUT=${TEMP_DIR}/expected

rm ${TEMP_DIR} -rf
mkdir -p ${TEMP_DIR}

function set_expected_output {
    output=$1
    echo -n "${output}" > ${EXPECTED_OUTPUT}
}

function post {
    url=$1
    curl -X POST "${url}" > ${ACTUAL_OUTPUT}
}

function get {
    url=$1
    curl -X GET "${url}" > ${ACTUAL_OUTPUT}
}

function check_results {
    diff ${ACTUAL_OUTPUT} ${EXPECTED_OUTPUT}
}

function post_and_check_results {
    url=$1
    output=$2
    set_expected_output "${output}"
    post "${url}"
    check_results
}

function get_and_check_results {
    url=$1
    output=$2
    set_expected_output "${output}"
    get "${url}"
    check_results
}

post_and_check_results "http://localhost:3000/create_account?account_name=bob&initial_balance=123" '{"status":"VALID"}'

get_and_check_results "http://localhost:3000/query_balance?account_name=bob" '123'

post_and_check_results "http://localhost:3000/create_account?account_name=alice&initial_balance=456" '{"status":"VALID"}'

get_and_check_results "http://localhost:3000/query_balance?account_name=alice" '456'

post_and_check_results "http://localhost:3000/create_account?account_name=alice&initial_balance=789" '{"message":"channel.sendTransactionProposal failed; error(s): chaincode error (status: 500, message: Could not create account named \"alice\"; account already exists); chaincode error (status: 500, message: Could not create account named \"alice\"; account already exists); "}'

get_and_check_results "http://localhost:3000/query_balance?account_name=alice" '456'

post_and_check_results "http://localhost:3000/transfer?from_account_name=alice&to_account_name=bob&amount=400" '{"status":"VALID"}'

get_and_check_results "http://localhost:3000/query_balance?account_name=alice" '56'

get_and_check_results "http://localhost:3000/query_balance?account_name=bob" '523'

post_and_check_results "http://localhost:3000/delete_account?account_name=bob" '{"status":"VALID"}'

get_and_check_results "http://localhost:3000/query_balance?account_name=bob" '{"message":"channel.sendTransactionProposal failed; error(s): chaincode error (status: 500, message: {\"Error\":\"Account named \"bob\" does not exist\"}); chaincode error (status: 500, message: {\"Error\":\"Account named \"bob\" does not exist\"}); "}'

post_and_check_results "http://localhost:3000/transfer?from_account_name=alice&to_account_name=bob&amount=50" '{"message":"channel.sendTransactionProposal failed; error(s): chaincode error (status: 500, message: Entity not found); chaincode error (status: 500, message: Entity not found); "}'

post_and_check_results "http://localhost:3000/create_account?account_name=bob&initial_balance=789" '{"status":"VALID"}'

get_and_check_results "http://localhost:3000/query_balance?account_name=bob" '789'

post_and_check_results "http://localhost:3000/transfer?from_account_name=alice&to_account_name=bob&amount=50" '{"status":"VALID"}'

get_and_check_results "http://localhost:3000/query_balance?account_name=alice" '6'

get_and_check_results "http://localhost:3000/query_balance?account_name=bob" '839'

rm ${TEMP_DIR} -rf

echo "....................................."
echo "all transactions behaved as expected."

