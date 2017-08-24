/*
Copyright IBM Corp. 2016 All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main


import (
    "fmt"
    "strconv"

    "github.com/hyperledger/fabric/core/chaincode/shim"
    pb "github.com/hyperledger/fabric/protos/peer"
)

import (
    "crypto/x509"
    "encoding/pem"

    // NOTE: This is temporarily vendored INSIDE THE github.com/example_cc DIR!
    "github.com/example_cc/golang/protobuf/proto"
    mspprotos "github.com/hyperledger/fabric/protos/msp"
)

// This code came from advice from Gari Singh
func GetCreatorCert (stub shim.ChaincodeStubInterface) (*x509.Certificate, error) {
    creator, err := stub.GetCreator()
    if err != nil {
        return nil, err
    }
    id := &mspprotos.SerializedIdentity{}
    err = proto.Unmarshal(creator, id)
    if err != nil {
        return nil, err
    }
    block, _ := pem.Decode(id.IdBytes)
    cert, err := x509.ParseCertificate(block.Bytes)
    return cert, err
}

func GetCreatorCommonName (stub shim.ChaincodeStubInterface) string {
    cert, err := GetCreatorCert(stub)
    if err != nil {
        panic(err)
    }
    return cert.Subject.CommonName
}

// SimpleChaincode example simple Chaincode implementation
type SimpleChaincode struct {
}

func (t *SimpleChaincode) Init(stub shim.ChaincodeStubInterface) pb.Response  {
    fmt.Println("########### example_cc Init ###########")
    _, args := stub.GetFunctionAndParameters()

    fmt.Printf("within Init : GetCreatorCommonName(stub): %v\n", GetCreatorCommonName(stub))

    if len(args) != 0 {
        return shim.Error("Incorrect number of arguments. Expecting 0")
    }

    return shim.Success(nil)
}

// Transaction makes payment of X units from A to B
func (t *SimpleChaincode) Invoke(stub shim.ChaincodeStubInterface) pb.Response {
    fmt.Println("########### example_cc Invoke ###########")
    function, args := stub.GetFunctionAndParameters()

    fmt.Printf("within Invoke : GetCreatorCommonName(stub): %v\n", GetCreatorCommonName(stub))

    if function == "create_account" {
        // Creates an account with the given name and initial balance
        return t.create_account(stub, args)
    }

    if function == "delete_account" {
        // Deletes an entity from its state
        return t.delete_account(stub, args)
    }

    if function == "query_balance" {
        // queries an entity state
        return t.query_balance(stub, args)
    }
    if function == "transfer" {
        // Deletes an entity from its state
        return t.transfer(stub, args)
    }
    return shim.Error(fmt.Sprintf("Unknown action '%s', check the first argument, must be one of 'create_account', 'delete', 'query_balance', or 'transfer'", function))
}

func (t *SimpleChaincode) create_account (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 2 {
        return shim.Error("Incorrect number of arguments.  Expecting 2; account_holder_name and initial_balance")
    }

    // Parse and validate the args.
    account_holder_name := args[0]
    initial_balance, err := strconv.Atoi(args[1])
    if err != nil {
        return shim.Error(fmt.Sprintf("Malformed initial_balance string \"%s\"; expecting nonnegative integer", args[1]))
    }
    if initial_balance < 0 {
        return shim.Error(fmt.Sprintf("Invalid initial_balance %v; expecting nonnegative integer", initial_balance))
    }

    // Check for an existing account
    existing_account_state,err := stub.GetState(account_holder_name)
    if err != nil {
        return shim.Error(err.Error()) // TODO: Better error message
    }
    if existing_account_state != nil {
        return shim.Error(fmt.Sprintf("Could not create account named \"%s\"; account already exists", account_holder_name))
    }

    // Write the account balance to the ledger.
    err = stub.PutState(account_holder_name, []byte(strconv.Itoa(initial_balance)))
    if err != nil {
        return shim.Error(err.Error()) // TODO: Better error message
    }

    return shim.Success(nil)
}

func (t *SimpleChaincode) transfer (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    // must be an invoke
    var A, B string    // Entities
    var Aval, Bval int // Asset holdings
    var X int          // Transaction value
    var err error

    if len(args) != 3 {
        return shim.Error("Incorrect number of arguments. Expecting 3; 2 names and 1 value")
    }

    A = args[0]
    B = args[1]
    X, err = strconv.Atoi(args[2])
    if err != nil {
        return shim.Error("Invalid transaction amount, expecting a integer value")
    }

    // Get the state from the ledger
    // TODO: will be nice to have a GetAllState call to ledger
    Avalbytes, err := stub.GetState(A)
    if err != nil {
        return shim.Error("Failed to get state")
    }
    if Avalbytes == nil {
        return shim.Error("Entity not found")
    }
    Aval, _ = strconv.Atoi(string(Avalbytes))

    Bvalbytes, err := stub.GetState(B)
    if err != nil {
        return shim.Error("Failed to get state")
    }
    if Bvalbytes == nil {
        return shim.Error("Entity not found")
    }
    Bval, _ = strconv.Atoi(string(Bvalbytes))

    // Perform the execution
    Aval = Aval - X
    Bval = Bval + X
    fmt.Printf("Aval = %d, Bval = %d\n", Aval, Bval)

    // Write the state back to the ledger
    err = stub.PutState(A, []byte(strconv.Itoa(Aval)))
    if err != nil {
        return shim.Error(err.Error())
    }

    err = stub.PutState(B, []byte(strconv.Itoa(Bval)))
    if err != nil {
        return shim.Error(err.Error())
    }

    return shim.Success(nil);
}

// Deletes the account of the named user.
func (t *SimpleChaincode) delete_account (stub shim.ChaincodeStubInterface, args []string) pb.Response {
    if len(args) != 1 {
        return shim.Error("Incorrect number of arguments. Expecting 1")
    }

    A := args[0]

    // Delete the key from the state in ledger
    err := stub.DelState(A)
    if err != nil {
        return shim.Error("Failed to delete state")
    }

    return shim.Success(nil)
}

// Query the balance of an account with specified username.
func (t *SimpleChaincode) query_balance (stub shim.ChaincodeStubInterface, args []string) pb.Response {

    var A string // Entities
    var err error

    if len(args) != 1 {
        return shim.Error("Incorrect number of arguments. Expecting name of the person to query")
    }

    A = args[0]

    // Get the state from the ledger
    Avalbytes, err := stub.GetState(A)
    if err != nil {
        jsonResp := "{\"Error\":\"Failed to get state for " + A + "\"}"
        return shim.Error(jsonResp)
    }
    if Avalbytes == nil {
        jsonResp := "{\"Error\":\"Account named \"" + A + "\" does not exist\"}"
        return shim.Error(jsonResp)
    }

    jsonResp := "{\"Name\":\"" + A + "\",\"Amount\":\"" + string(Avalbytes) + "\"}"
    fmt.Printf("Query Response:%s\n", jsonResp)
    return shim.Success(Avalbytes)
}

func main() {
    err := shim.Start(new(SimpleChaincode))
    if err != nil {
        fmt.Printf("Error starting Simple chaincode: %s", err)
    }
}
