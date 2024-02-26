import { BOC, Slice, Hashmap, Cell, Bit } from "ton3-core"
import * as fs from 'fs'
import { OpcodeParser, VarMap } from "./disasm"
import { Stack } from "./stackAnalysis";
import { bitsToBigInt, bitsToIntUint } from "ton3-core/dist/utils/numbers";

let disassembleSlice = (slice: Slice) => {
    let code = [];
    while (slice.bits.length > 0) {
        let [instruction, operands] = OpcodeParser.nextInstruction(slice);
        if (instruction.mnemonic == "PUSHCONT_SHORT" || instruction.mnemonic == "PUSHCONT") {
            operands["s"] = disassembleSlice(operands["s"]);
        }
        if (instruction.mnemonic === "DICTPUSHCONST") {
            const keySize: number = operands["n"]
            let hashMap = Hashmap.parse(keySize, operands["d"])
            hashMap.forEach((k: Bit[], v: Cell) => {
                const keyNumber = bitsToIntUint(k, { type: "int" })
                let valueSlice = v.slice()
                
                let instructions = disassembleSlice(valueSlice)
                operands["m" + keyNumber] = instructions
            })
        }
        if (instruction.mnemonic === "PUSHREFCONT") {
            operands["c"] = disassembleSlice(operands["c"]);
        }
        code.push({ "instruction": instruction, "operands": operands, "inputs": instruction.value_flow?.inputs?.stack, "outputs": instruction.value_flow?.outputs?.stack });
    }
    return code;
};

const boc = BOC.from(new Uint8Array(fs.readFileSync(process.argv[2])))
const slice = boc.root[0].slice();

let instructions = disassembleSlice(slice);

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
        valueFlow.push({
            opcode: instruction.instruction.mnemonic,
            operands: newOperands,
            // inputs: newInputs,
            // outputs: newOutputs
        });
    }
    return valueFlow;
};

let vizualize = (valueFlow: any) => {
    const indentString = (str: string, count: number, indent = " ") => {
        indent = indent.repeat(count);
        return str.replace(/^/gm, indent);
      };
    let code = "";
    for (let instruction of valueFlow) {
        if (instruction.inputs == undefined || instruction.outputs == undefined) {
            continue;
        }
        let outputVars = Object.values(instruction.outputs).map((output: any) => output.var.name).join(', ');
        let inputVars = Object.values(instruction.inputs).map((input: any) => input.var.name);
        let conts = [];
        for (const operand in instruction.operands) {
            let v = instruction.operands[operand];
            if (v instanceof Array) {
                conts.push("{\n" + indentString(vizualize(v), 4) + "\n}");
                delete instruction.operands[operand];
            }
        }
        let operands = Object.values(instruction.operands).map(x => `${x}`);
        let inputStr = conts.concat(...operands).concat(...inputVars).join(', ');
        code += (outputVars ? `const ${outputVars} = ` : '') + `${instruction.opcode}(${inputStr});\n`;
    }
    return code;
};

let valueFlow = analyzeContStack(instructions, stack);

let code = vizualize(valueFlow);

console.dir(valueFlow, { depth: null, color: true })
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
