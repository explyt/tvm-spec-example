import { BOC, Slice, Hashmap, Cell, Bit } from "ton3-core"
import * as fs from 'fs'
import { OpcodeParser, VarMap } from "./disasm"
import { Stack } from "./stackAnalysis";
import { bitsToBigInt, bitsToIntUint } from "ton3-core/dist/utils/numbers";

function toTitleCase(str: string) {
    return str.replace(
      /\w\S*/g,
      function(txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
      }
    );
  }

// class TvmInst {
//     mnemonic: string;
//     operands: VarMap;

//     constructor(mnemonic: string, operands: VarMap) {
//         this.mnemonic = mnemonic;
//         this.operands = operands;
//     }

//     toJSON() {
//         return `Tvm${toTitleCase(this.mnemonic)}Inst: ` + JSON.stringify(this.operands)
//     }
// }

interface TvmCodeBlock {
    // type: string
    instList: TvmInst[];
}

class TvmMethod implements TvmCodeBlock {
    // type: string = "TvmMethod"
    id: number;
    instList = []
    
    constructor(id: number) {
        this.id = id;
    }
}

class TvmLambda implements TvmCodeBlock {
    // type: string = "TvmLambda"
    instList = []
}

interface TvmInstLocation {
    type: string
    index: number;
}

class TvmInstMethodLocation implements TvmInstLocation {
    type: string = "TvmInstMethodLocation"
    methodId: number;
    index: number;

    constructor(methodId: number, index: number) {
        this.methodId = methodId;
        this.index = index;
    }
}

class TvmInstLambdaLocation implements TvmInstLocation {
    type: string = "TvmInstLambdaLocation"
    index: number;

    constructor(index: number) {
        this.index = index;
    }
}

class TvmInst {
    type: string;
    location: TvmInstLocation;
    operands: VarMap

    constructor(mnemonic: string, location: TvmInstLocation, operands: VarMap) {
        this.type = mnemonic
        this.location = location
        this.operands = operands
    }

    toJSON() {
        let json: { [id: string] : any } = {}
        json["type"] = this.type
        json["location"] = this.location

        for (const k in this.operands) {
            json[k] = this.operands[k]
        }

        return json;
    }
}

class TvmContract {
    methods: { [methodId: number]: TvmMethod } = {}
}

let disassembleSlice = (slice: Slice, contractCode: TvmContract, methodId: number | null, instList: TvmInst[]) => {
    // let code = [];
    let instIndex = 0
    while (slice.bits.length > 0) {
        let [instruction, operands] = OpcodeParser.nextInstruction(slice);
        const mnemonic = instruction.mnemonic;
        if (mnemonic == "PUSHCONT_SHORT" || mnemonic == "PUSHCONT") {
            let lambda = new TvmLambda()
            operands["s"] = disassembleSlice(operands["s"], contractCode, null, lambda.instList);
        }
        if (mnemonic === "DICTPUSHCONST") {
            const keySize: number = operands["n"]
            let hashMap = Hashmap.parse(keySize, operands["d"])
            hashMap.forEach((k: Bit[], v: Cell) => {
                const keyNumber = bitsToIntUint(k, { type: "int" })
                let valueSlice = v.slice()

                let newMethod = new TvmMethod(keyNumber)
                contractCode.methods[keyNumber] = newMethod

                let instructions = disassembleSlice(valueSlice, contractCode, keyNumber, newMethod.instList)
                // operands["m" + keyNumber] = instructions
            })

            // Keep just key size
            delete operands["d"]
        }
        if (mnemonic === "PUSHREFCONT" || mnemonic === "IFREF" || mnemonic === "IFNOTREF" || mnemonic === "IFJMPREF"
            || mnemonic === "IFNOTJMPREF" || mnemonic === "IFREFELSE" || mnemonic === "IFELSEREF"
            || mnemonic === "IFBITJMPREF" || mnemonic === "IFNBITJMPREF" || mnemonic === "CALLREF" || mnemonic === "PUSHREF") {
            let lambda = new TvmLambda();
            operands["c"] = disassembleSlice(operands["c"], contractCode, null, lambda.instList);
        }
        if (mnemonic === "IFREFELSEREF") {
            let lambda1 = new TvmLambda();
            let lambda2 = new TvmLambda();
            operands["c1"] = disassembleSlice(operands["c1"], contractCode, null, lambda1.instList);
            operands["c2"] = disassembleSlice(operands["c2"], contractCode, null, lambda2.instList);
        }

        let instLocation = undefined
        if (methodId == null) {
            instLocation = new TvmInstLambdaLocation(instIndex)
        } else {
            instLocation = new TvmInstMethodLocation(methodId, instIndex)
        }
        instIndex++
        // let operandsString = Object.values(operands).map(x => `${x}`);
        const tvmInst = new TvmInst(instruction.mnemonic, instLocation, operands)
        instList.push(tvmInst)

        // code.push({ "instruction": instruction, "operands": operands, "inputs": instruction.value_flow?.inputs?.stack, "outputs": instruction.value_flow?.outputs?.stack });
    }
    // return code;
    return instList;
};

const boc = BOC.from(new Uint8Array(fs.readFileSync(process.argv[2])))
const slice = boc.root[0].slice();
let contractCode = new TvmContract()
const maxMethodId = 2147483647
let mainMethod = new TvmMethod(maxMethodId)
contractCode.methods[maxMethodId] = mainMethod

let instructions = disassembleSlice(slice, contractCode, maxMethodId, mainMethod.instList);

let stack = new Stack([{ name: "body" }, { name: "selector" }]);

let analyzeContStack = (instructions: any, stack: Stack) => {
    let valueFlow = [];
    for (let instruction of instructions) {
        const mnemonic = instruction.instruction.mnemonic
        if ((instruction.inputs == undefined || instruction.outputs == undefined)) {
            // stack.execStackInstruction(instruction.instruction, instruction.operands);

            let newOperands: VarMap = {};
            for (const operand in instruction.operands) {
                let v = instruction.operands[operand];
                if (v instanceof Array) {
                    v = analyzeContStack(v, stack.copy());
                }
                newOperands[operand] = v;
            }

            // valueFlow.push({
            //     opcode: mnemonic,
            //     operands: newOperands
            // });

            // let inst = []
            // inst.push({ "opcode": mnemonic })
            // for (const operand in instruction.operands) {
            //     inst.push({ operand: newOperands[operand] })
            // }
            // valueFlow.push(inst)
            valueFlow.push({
                opcode: mnemonic,
                operands: newOperands
            });
            continue;
        }
        // let newInputs: VarMap = {};
        // for (let input of instruction.inputs.reverse()) {
        //     if (input.type == 'simple') {
        //         newInputs[input.name] = { var: stack.pop(), types: input.value_types };
        //     } else {
        //         throw new Error("not supported");
        //     }
        // }
        // let newOutputs: VarMap = {};
        // for (let output of instruction.outputs) {
        //     if (output.type == 'simple') {
        //         newOutputs[output.name] = { var: stack.push(), types: output.value_types };
        //     } else {
        //         throw new Error("not supported");
        //     }
        // }
        let newOperands: VarMap = {};
        for (const operand in instruction.operands) {
            let v = instruction.operands[operand];
            if (v instanceof Array) {
                v = analyzeContStack(v, stack.copy());
            }
            newOperands[operand] = v;
        }
        // valueFlow.push({
        //     opcode: instruction.instruction.mnemonic,
        //     operands: newOperands,
        //     // inputs: newInputs,
        //     // outputs: newOutputs
        // });
        
        // let inst = []
        // inst.push({ "opcode": instruction.instruction.mnemonic })
        // for (const operand in instruction.operands) {
        //     inst.push({ operand: newOperands[operand] })
        // }
        // valueFlow.push(inst)
        valueFlow.push({
            opcode: instruction.instruction.mnemonic,
            operands: newOperands
        });
    }
    return valueFlow;
};

// let vizualize = (valueFlow: any) => {
//     const indentString = (str: string, count: number, indent = " ") => {
//         indent = indent.repeat(count);
//         return str.replace(/^/gm, indent);
//       };
//     let code = "";
//     for (let instruction of valueFlow) {
//         if (instruction.inputs == undefined || instruction.outputs == undefined) {
//             continue;
//         }
//         let outputVars = Object.values(instruction.outputs).map((output: any) => output.var.name).join(', ');
//         let inputVars = Object.values(instruction.inputs).map((input: any) => input.var.name);
//         let conts = [];
//         for (const operand in instruction.operands) {
//             let v = instruction.operands[operand];
//             if (v instanceof Array) {
//                 conts.push("{\n" + indentString(vizualize(v), 4) + "\n}");
//                 delete instruction.operands[operand];
//             }
//         }
//         let operands = Object.values(instruction.operands).map(x => `${x}`);
//         let inputStr = conts.concat(...operands).concat(...inputVars).join(', ');
//         code += (outputVars ? `const ${outputVars} = ` : '') + `${instruction.opcode}(${inputStr});\n`;
//     }
//     return code;
// };

// let valueFlow = analyzeContStack(instructions, stack);

// let code = vizualize(valueFlow);

// console.dir(valueFlow, { depth: null, color: true })
// console.dir(contractCode, { depth: null, color: true })
// console.dir(JSON.stringify(contractCode), { depth: null, color: true })
console.log(JSON.stringify(contractCode, null, 1))
// console.dir(JSON.stringify(valueFlow), { depth: null, color: true })
// console.log(code)






// let cells = [/* OpcodeParser.dictSlice!.refs[0],  */OpcodeParser.dictSlice!.refs[1].refs[0]]

// for (var i = 0; i < cells.length; i++) {
//     let subCell = cells[i];
//     console.log("Bits " + subCell.bits)
//     for (var j = 0; j < subCell.bits.length; j++) {
//         try {
//             let instructions = disassembleSlice(subCell.slice().skipBits(j));
//             let stack = new Stack([{ name: "body" }, { name: "selector" }]);
//             let valueFlow = analyzeContStack(instructions, stack);
//             code = vizualize(valueFlow);

//             console.log("Skipping bits: " + j)
//             console.dir(valueFlow, { depth: null, color: true })
//             console.log(code)
//             break
//         } catch (e) {
//             console.log("Step " + j, ", error: " + e)
//             // try {
//             // } catch (e) {
//                 // throw new Error("OpcodeParser: prefix load error", { cause: e })
//             // }
//         }
//     }
//     console.log("=================================================================================================================================================================================")
// }

// let dictSlice = boc.root[0].refs[0].slice()
// let hashMap = Hashmap.parse(19, dictSlice)
// console.log(hashMap)
// hashMap.forEach((k: Bit[], v: Cell) => {
//     const keyNumber = bitsToIntUint(k, { type: "int" })
//     console.log("Key: " + keyNumber)
//     let valueSlice = v.slice()
    
//     let instructions = disassembleSlice(valueSlice);
//     let stack = new Stack([{ name: "body" }, { name: "selector" }]);
//     let valueFlow = analyzeContStack(instructions, stack);
//     code = vizualize(valueFlow);

//     console.dir(valueFlow, { depth: null, color: true })
//     console.log(code)

//     console.log("=================================================================================================================================================================================")
// })
